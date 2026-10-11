// Per-tab ratings persistence, independent of DOM rendering.
(function (root) {
  root.createOverlayCache = function ({ Config, Model, log, getServer, getListIndex, restoreListIndex, onCacheCleared }) {
    // key: `${mediaType}:${tmdbId}`, value: { bundle }. `pending:` keys hold the
    // in-flight promise instead, so serialisation skips them.
    const ratingsCache = new Map();
    const publicRatings = new Map();

    // Resolved bundles persist so a page reload does not re-resolve every card.
    // Aging entries remain renderable while sources refresh in the background;
    // the entry cap and explicit cache clearing still bound persistence.
    const PERSISTED_RATINGS_KEY = 'overlayRatingsV1';
    // Seerr withholds a card's link and title until it is hovered, so a cold
    // load cannot identify cards from the DOM alone. The title lists Seerr
    // already fetched persist alongside the scores, and the next load hydrates
    // from them before any network answers. Tiny per title, bounded below.
    const PERSISTED_LIST_INDEX_MAX_ENTRIES = Config.listIndexMaxEntries ?? 2000;
    // A cached bundle carries the confidence the matcher gave it, and a cache hit
    // never re-runs the matcher, so entries scored under superseded rules would
    // keep the old verdict forever. Config.matcherVersion is the stamp; see there.
    const PERSISTED_RATINGS_FLUSH_MS = 500;
    let persistedRatingsReady = null;
    let persistedRatingsFlushTimer = null;
    let persistedRatingsFlushing = null;
    let generation = 0;
    let epoch = 0;
    let persistedEntries = new Map();
    let persistedIndex = new Map();
    const indexKey = item => `${item.mediaType}:${item.tmdbId}`;
    const indexFingerprint = item => JSON.stringify([String(item.tmdbId), item.mediaType, item.title || '',
      item.originalTitle || '', item.year ?? null, item.posterPath || null, item.releaseDate || '', item.firstAirDate || '']);
    const storedEntry = value => ({ bundle: value.bundle ?? null, cachedAt: value.cachedAt ?? null,
      retryAt: value.retryAt ?? null, ...(typeof value.publicCheckedAt === 'number' ? { publicCheckedAt: value.publicCheckedAt } : {}), diagnostics: value.diagnostics ?? null });

    function loadPersistedRatings() {
      const expected = generation;
      persistedRatingsReady ??= (async () => {
        try {
          const response = await chrome.runtime.sendMessage({ action: 'getOverlayCache' });
          if (!response?.success) throw new Error(response?.error || 'Cache read unavailable');
          const local = response.data;
          if (expected !== generation) return loadPersistedRatings();
          epoch = local.ratingsCacheEpoch ?? 0;
          publicRatings.clear();
          if (local.publicRatingsV1?.matcher === Config.matcherVersion) {
            for (const [key, entry] of Object.entries(local.publicRatingsV1.entries || {})) {
              if (entry.expiresAt > Date.now()) publicRatings.set(key, { ...entry,
                bundle: Model.createRatingsBundle({ ...entry.value, lastUpdated: entry.checkedAt }) });
            }
          }
          const stored = local[PERSISTED_RATINGS_KEY];
          if (!stored || typeof stored !== 'object' || (stored.epoch ?? 0) !== epoch) return true;
          // Entries belong to the server they were read from.
          if (stored.server !== getServer()?.href) return true;
          // The title index is Seerr's own catalogue data, not a matcher
          // verdict, so it survives a matcher change that discards scores.
          if (Array.isArray(stored.index) && typeof restoreListIndex === 'function') {
            persistedIndex = new Map(stored.index.map(item => [indexKey(item), indexFingerprint(item)]));
            try {
              restoreListIndex(stored.index);
            } catch (error) {
              log('Could not restore the stored title index:', error);
            }
          }
          // Scored under rules we no longer use: cheaper to look them up again
          // than to show every title a verdict the current matcher disagrees with.
          if (stored.matcher !== Config.matcherVersion) {
            log('The ratings matcher has changed since these were cached; resolving them again');
            return true;
          }
          if (!stored.entries || typeof stored.entries !== 'object') return true;
          // Load oldest first so the Map's LRU order keeps recent checks.
          for (const [key, entry] of Object.entries(stored.entries).slice(-Config.overlayCacheMaxEntries)
            .sort((a, b) => (a[1]?.cachedAt || 0) - (b[1]?.cachedAt || 0))) {
            // A live entry from this session is fresher than anything stored.
            if (!entry || typeof entry !== 'object') continue;
            const bundle = entry.bundle;
            const cachedAt = typeof entry.cachedAt === 'number' ? entry.cachedAt : null;
            const loaded = { bundle: bundle ? Model.createRatingsBundle(bundle) : null, cachedAt,
              ...(typeof entry.retryAt === 'number' ? { retryAt: entry.retryAt } : {}),
              ...(typeof entry.publicCheckedAt === 'number' ? { publicCheckedAt: entry.publicCheckedAt } : {}),
              ...(entry.diagnostics && typeof entry.diagnostics === 'object' ? { diagnostics: entry.diagnostics } : {}) };
            persistedEntries.set(key, JSON.stringify(storedEntry(loaded)));
            if (ratingsCache.has(key)) continue;
            if (!bundle) {
              // A remembered "nothing", worth keeping only while it is current.
              const retryMs = entry.diagnostics?.status === 'uncertain' ? Config.partialRatingsRetryMs : Config.unratedRetryMs;
              const retryAt = Math.min((cachedAt ?? 0) + retryMs, loaded.retryAt ?? Infinity);
              if (cachedAt === null || Date.now() >= retryAt) continue;
              ratingsCache.set(key, loaded);
              continue;
            }
            if (typeof bundle !== 'object') continue;
            ratingsCache.set(key, loaded);
          }
          return true;
        } catch (error) {
          log('Could not read the stored ratings cache:', error);
          if (expected === generation) persistedRatingsReady = null;
          return false;
        }
      })();
      return persistedRatingsReady;
    }

    // Refresh only the public tier. Reloading the full cache here would also
    // replay a server's stored catalogue over live observations.
    async function refreshPublicRatings() {
      const expected = generation;
      const server = getServer()?.href;
      try {
        await loadPersistedRatings();
        if (expected !== generation || !server || server !== getServer()?.href) return [];
        const response = await chrome.runtime.sendMessage({ action: 'getOverlayCache' });
        if (!response?.success) throw new Error(response?.error || 'Public cache read unavailable');
        if (expected !== generation || server !== getServer()?.href) return [];
        if ((response.data?.ratingsCacheEpoch ?? 0) !== epoch) {
          // A tab can miss the original clear broadcast. The epoch is
          // authoritative even when this reply contains no public entries.
          resetClearedCache();
          return [];
        }
        const payload = response.data?.publicRatingsV1;
        if (payload?.matcher !== Config.matcherVersion) return [];
        const changed = [];
        for (const [key, entry] of publicRatings) {
          if (entry.expiresAt <= Date.now()) publicRatings.delete(key);
        }
        // Responses can arrive out of order. Merge by provider check time,
        // leaving newer records and this server's native cache untouched.
        for (const [key, entry] of Object.entries(payload.entries || {})) {
          if (entry.expiresAt <= Date.now()) continue;
          const previous = publicRatings.get(key);
          if (previous && previous.checkedAt >= entry.checkedAt) continue;
          publicRatings.set(key, { ...entry,
            bundle: Model.createRatingsBundle({ ...entry.value, lastUpdated: entry.checkedAt }) });
          changed.push(key);
        }
        if (publicRatings.size > Config.rtCacheMaxEntries) {
          const oldest = [...publicRatings].sort((a, b) => a[1].checkedAt - b[1].checkedAt);
          for (const [key] of oldest.slice(0, publicRatings.size - Config.rtCacheMaxEntries)) publicRatings.delete(key);
        }
        return changed.filter(key => publicRatings.has(key));
      } catch (error) {
        log('Could not refresh public ratings:', error);
        return [];
      }
    }

    function schedulePersistedRatingsFlush() {
      if (persistedRatingsFlushTimer !== null) return;
      persistedRatingsFlushTimer = setTimeout(() => {
        persistedRatingsFlushTimer = null;
        flushPersistedRatings();
      }, PERSISTED_RATINGS_FLUSH_MS);
    }

    // Serialised so overlapping flushes cannot interleave their writes.
    // Also coalesces a debounced write already waiting: flushing now covers it.
    function flushPersistedRatings() {
      const expected = generation;
      const server = getServer()?.href;
      if (persistedRatingsFlushTimer !== null) {
        clearTimeout(persistedRatingsFlushTimer);
        persistedRatingsFlushTimer = null;
      }
      persistedRatingsFlushing = (persistedRatingsFlushing ?? Promise.resolve()).then(async () => {
        try {
          if (!await loadPersistedRatings()) return;
          if (!server || expected !== generation || server !== getServer()?.href) return;
          const writeEpoch = epoch;
          const entries = {};
          for (const [key, value] of ratingsCache) {
            if (key.startsWith('pending:') || !value) continue;
            // A failed lookup is remembered only for this page, never on disk.
            if (value.provisional) continue;
            // A null bundle is a remembered "nothing knows this title", and it is
            // kept: that is what stops the same lookups running on every visit.
            // Every one carries the timestamp that lets it expire, because the
            // only two ways into this cache set one, and the loader refuses an
            // absence that has none.
            if (value.bundle && !Model.hasAnyScore(value.bundle)) continue;
            entries[key] = storedEntry(value);
          }
          let index = [];
          if (typeof getListIndex === 'function') {
            try {
              const projected = getListIndex() || [];
              index = projected.slice(-PERSISTED_LIST_INDEX_MAX_ENTRIES);
            } catch (error) {
              log('Could not project the title index:', error);
            }
          }
          // A tab sends only its changes. Re-sending an unchanged snapshot
          // could overwrite another tab's fresher scores or deleted entries.
          const snapshot = new Map(Object.entries(entries).map(([key, value]) => [key, JSON.stringify(value)]));
          const changed = Object.fromEntries(Object.entries(entries).filter(([key]) => snapshot.get(key) !== persistedEntries.get(key)));
          const removed = [...persistedEntries].filter(([key]) => !snapshot.has(key))
            .map(([key, value]) => {
              const entry = JSON.parse(value);
              return { key, cachedAt: entry.cachedAt, publicCheckedAt: entry.publicCheckedAt ?? null, expected: entry };
            });
          const indexSnapshot = new Map(index.map(item => [indexKey(item), indexFingerprint(item)]));
          const indexChanges = index.filter(item => indexSnapshot.get(indexKey(item)) !== persistedIndex.get(indexKey(item)));
          const reply = await chrome.runtime.sendMessage({ action: 'putOverlayCache',
            data: { server, epoch: writeEpoch, matcher: Config.matcherVersion, delta: true, entries: changed, removed, index: indexChanges }
          });
          if (!reply?.success) throw new Error(reply?.error || 'Cache write unavailable');
          if (expected !== generation) return;
          if (reply.data?.stored === false) {
            // A missed clear notification must not pin this tab to an old
            // epoch or restore pre-clear ratings on its next attempt.
            resetClearedCache();
            return;
          }
          persistedEntries = snapshot; persistedIndex = indexSnapshot;
        } catch (error) {
          log('Could not persist the ratings cache:', error);
        }
      });
      return persistedRatingsFlushing;
    }

    function resetClearedCache() {
      // Reset the rendered overlay as well as memory when the bridge discovers
      // a missed clear through either a read epoch or a rejected write.
      if (typeof onCacheCleared === 'function') onCacheCleared();
      else forgetPersistedRatings();
    }

    function forgetPersistedRatings() {
      generation++;
      clearTimeout(persistedRatingsFlushTimer);
      persistedRatingsFlushTimer = null;
      ratingsCache.clear();
      publicRatings.clear();
      persistedRatingsReady = null;
      persistedEntries.clear(); persistedIndex.clear();
    }

    function getPublicRating(key, year = null) {
      const entry = publicRatings.get(key);
      return entry && entry.expiresAt > Date.now() && (!year || Number(year) === entry.value.matchedYear) ? entry : null;
    }

    return { ratingsCache, getPublicRating, refreshPublicRatings, loadPersistedRatings, schedulePersistedRatingsFlush, flushPersistedRatings, forgetPersistedRatings };
  };
})(typeof window !== 'undefined' ? window : globalThis);

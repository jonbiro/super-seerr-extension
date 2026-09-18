// Per-tab ratings persistence, independent of DOM rendering.
(function (root) {
  root.createOverlayCache = function ({ Config, Model, log, getServer }) {
    // key: `${mediaType}:${tmdbId}`, value: { bundle }. `pending:` keys hold the
    // in-flight promise instead, so serialisation skips them.
    const ratingsCache = new Map();

    // Resolved bundles persist so a page reload does not re-resolve every card.
    // There is no expiry by design: entries live until the entry cap evicts them
    // or the user clears the cache from Settings.
    const PERSISTED_RATINGS_KEY = 'overlayRatingsV1';
    // A cached bundle carries the confidence the matcher gave it, and a cache hit
    // never re-runs the matcher, so entries scored under superseded rules would
    // keep the old verdict forever. Config.matcherVersion is the stamp; see there.
    const PERSISTED_RATINGS_FLUSH_MS = 500;
    let persistedRatingsReady = null;
    let persistedRatingsFlushTimer = null;
    let persistedRatingsFlushing = null;
    let generation = 0;
    let epoch = 0;

    function loadPersistedRatings() {
      const expected = generation;
      persistedRatingsReady ??= (async () => {
        try {
          const local = await chrome.storage.local.get([PERSISTED_RATINGS_KEY, 'ratingsCacheEpoch']);
          if (expected !== generation) return loadPersistedRatings();
          epoch = local.ratingsCacheEpoch ?? 0;
          const stored = local[PERSISTED_RATINGS_KEY];
          if (!stored || typeof stored !== 'object' || (stored.epoch ?? 0) !== epoch) return;
          // Entries belong to the server they were read from.
          if (stored.server !== getServer()?.href) return;
          // Scored under rules we no longer use: cheaper to look them up again
          // than to show every title a verdict the current matcher disagrees with.
          if (stored.matcher !== Config.matcherVersion) {
            log('The ratings matcher has changed since these were cached; resolving them again');
            return;
          }
          if (!stored.entries || typeof stored.entries !== 'object') return;
          for (const [key, entry] of Object.entries(stored.entries).slice(-Config.overlayCacheMaxEntries)) {
            // A live entry from this session is fresher than anything stored.
            if (ratingsCache.has(key) || !entry || typeof entry !== 'object') continue;
            const bundle = entry.bundle;
            const cachedAt = typeof entry.cachedAt === 'number' ? entry.cachedAt : null;
            if (!bundle) {
              // A remembered "nothing", worth keeping only while it is current.
              if (cachedAt === null || Date.now() - cachedAt >= Config.unratedRetryMs) continue;
              ratingsCache.set(key, { bundle: null, cachedAt });
              continue;
            }
            if (typeof bundle !== 'object') continue;
            ratingsCache.set(key, { bundle: Model.createRatingsBundle(bundle), cachedAt });
          }
        } catch (error) {
          log('Could not read the stored ratings cache:', error);
        }
      })();
      return persistedRatingsReady;
    }

    function schedulePersistedRatingsFlush() {
      if (persistedRatingsFlushTimer !== null) return;
      persistedRatingsFlushTimer = setTimeout(() => {
        persistedRatingsFlushTimer = null;
        flushPersistedRatings();
      }, PERSISTED_RATINGS_FLUSH_MS);
    }

    // Serialised so overlapping flushes cannot interleave their writes.
    function flushPersistedRatings() {
      const expected = generation;
      const server = getServer()?.href;
      const writeEpoch = epoch;
      persistedRatingsFlushing = (persistedRatingsFlushing ?? Promise.resolve()).then(async () => {
        try {
          const local = await chrome.storage.local.get(['ratingsCacheEpoch']);
          if (!server || expected !== generation || server !== getServer()?.href || (local.ratingsCacheEpoch ?? 0) !== writeEpoch) return;
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
            entries[key] = { bundle: value.bundle ?? null, cachedAt: value.cachedAt ?? null };
          }
          await chrome.storage.local.set({
            [PERSISTED_RATINGS_KEY]: { server, epoch: writeEpoch, matcher: Config.matcherVersion, entries }
          });
        } catch (error) {
          log('Could not persist the ratings cache:', error);
        }
      });
      return persistedRatingsFlushing;
    }

    function forgetPersistedRatings() {
      generation++;
      clearTimeout(persistedRatingsFlushTimer);
      persistedRatingsFlushTimer = null;
      ratingsCache.clear();
      persistedRatingsReady = null;
    }

    return { ratingsCache, loadPersistedRatings, schedulePersistedRatingsFlush, flushPersistedRatings, forgetPersistedRatings };
  };
})(globalThis);

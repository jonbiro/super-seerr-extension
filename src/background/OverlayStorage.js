// The configured Seerr page can exchange only its bounded ratings cache.
(function (root) {
  const KEY = 'overlayRatingsV1';
  const SITES_KEY = 'overlayRatingsByServerV1';
  const serverKey = value => {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid cache server');
    return url.href.replace(/\/+$/, '');
  };
  const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
  const text = (value, max = 300) => typeof value === 'string' ? value.slice(0, max) : '';
  const number = (value, max = Infinity) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : null;
  const safeTmdbId = value => {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const textValue = String(value);
    if (!/^\d+$/.test(textValue)) return null;
    const id = Number(textValue);
    return Number.isSafeInteger(id) && id > 0 ? String(id) : null;
  };
  const cacheFreshness = value => Object.values(value?.entries || {}).reduce((latest, entry) =>
    Math.max(latest, number(entry?.cachedAt) ?? 0), 0);
  const boundedSiteCaches = caches => Object.fromEntries(Object.entries(caches)
    .sort((a, b) => cacheFreshness(b[1]) - cacheFreshness(a[1])).slice(0, 10));
  root.OverlayStorage = {
    async restrictLocalStorage() {
      if (!chrome.storage.local.setAccessLevel) return false;
      try {
        await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
        this.localStorageIsolationSupported = true;
        return true;
      } catch (_) {
        // The API is optional (notably on Firefox) and can also reject on a
        // browser policy/version mismatch. The worker-side bridge still
        // protects secrets and cache payloads, so keep the extension usable.
        this.localStorageIsolationSupported = false;
        console.warn('Could not restrict extension storage to trusted contexts; continuing with bridge validation.');
        return false;
      }
    },
    overlayStorageServer(sender) {
      this.assertConnectionTarget({}, sender);
      const server = new URL(this.baseUrl);
      const page = new URL(sender?.url);
      const base = server.pathname.replace(/\/+$/, '');
      if (sender?.id !== chrome.runtime.id || !Number.isInteger(sender?.tab?.id) || (sender.frameId ?? 0) !== 0 ||
          page.origin !== server.origin || !(page.pathname === base || page.pathname.startsWith(`${base}/`))) {
        throw new Error('Cache access requires the configured Seerr page');
      }
      return server.href;
    },
    queueOverlayStorage(operation) {
      const pending = (this.overlayStorageQueue || Promise.resolve()).then(operation);
      this.overlayStorageQueue = pending.catch(() => {});
      return pending;
    },
    sanitizeOverlayCache(value, server, epoch) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || value.server !== server || (value.epoch ?? 0) !== epoch) return null;
      if (JSON.stringify(value).length > 3_000_000) throw new Error('Ratings cache exceeds the size limit');
      const entries = {};
      const cacheTime = value => number(value, Date.now() + 60000) ?? -1;
      const storedEntries = Object.entries(value.entries || {})
        // Reject malformed keys/records before applying the cap. Otherwise a
        // corrupt record can occupy a slot and hide a valid cached title.
        .filter(([key, entry]) => /^(movie|tv):[1-9]\d*$/.test(key) &&
          Number.isSafeInteger(Number(key.split(':')[1])) && entry && typeof entry === 'object')
        .sort((a, b) => cacheTime(b[1]?.cachedAt) - cacheTime(a[1]?.cachedAt))
        .slice(0, root.RatingsConfig.overlayCacheMaxEntries);
      for (const [key, entry] of storedEntries) {
        if (!/^(movie|tv):[1-9]\d*$/.test(key) || !Number.isSafeInteger(Number(key.split(':')[1])) || !entry || typeof entry !== 'object') continue;
        const bundle = entry.bundle && typeof entry.bundle === 'object' ? {
          rtCriticsScore: number(entry.bundle.rtCriticsScore, 100), rtAudienceScore: number(entry.bundle.rtAudienceScore, 100),
          imdbRating: number(entry.bundle.imdbRating, 10), tmdbRating: number(entry.bundle.tmdbRating, 10),
          confidence: number(entry.bundle.confidence, 1) ?? 0, source: text(entry.bundle.source, 100),
          lastUpdated: typeof entry.bundle.lastUpdated === 'string' ? text(entry.bundle.lastUpdated, 50) : number(entry.bundle.lastUpdated)
        } : null;
        const diagnostics = ['rated', 'partial', 'unrated', 'failed', 'uncertain'].includes(entry.diagnostics?.status) ? {
          status: entry.diagnostics.status, checkedAt: number(entry.diagnostics.checkedAt, Date.now() + 60000), source: text(entry.diagnostics.source, 100)
        } : null;
        const nativeRemovedAt = Object.fromEntries(['imdbRating', 'tmdbRating'].filter(field =>
          number(entry.nativeRemovedAt?.[field], Date.now() + 60000) !== null
        ).map(field => [field, entry.nativeRemovedAt[field]]));
        entries[key] = { bundle, cachedAt: number(entry.cachedAt, Date.now() + 60000), retryAt: number(entry.retryAt, Date.now() + root.RatingsConfig.ratingsFreshMs),
          ...(number(entry.publicCheckedAt, Date.now() + 60000) !== null ? { publicCheckedAt: entry.publicCheckedAt } : {}), diagnostics, ...(Object.keys(nativeRemovedAt).length ? { nativeRemovedAt } : {}) };
      }
      const index = (Array.isArray(value.index) ? value.index : []).map(item => {
        const tmdbId = safeTmdbId(item?.tmdbId);
        if (!item || !/^(movie|tv)$/.test(item.mediaType) || !tmdbId) return null;
        return { tmdbId, mediaType: item.mediaType, title: text(item.title), originalTitle: text(item.originalTitle),
          year: number(item.year, 9999), posterPath: text(item.posterPath, 500) || null, releaseDate: text(item.releaseDate, 20), firstAirDate: text(item.firstAirDate, 20) };
      }).filter(Boolean).slice(-root.RatingsConfig.listIndexMaxEntries);
      return { server, epoch, matcher: number(value.matcher), entries, index };
    },
    boundedOverlayCache(value) {
      // Ten sites use at most roughly 6 MB, leaving room for shared RT data
      // and settings. Retain the most recently checked titles and list items.
      const entries = {};
      let remaining = 400_000;
      for (const [key, entry] of Object.entries(value.entries).sort((a, b) =>
        (number(b[1]?.cachedAt) ?? 0) - (number(a[1]?.cachedAt) ?? 0))
        .slice(0, root.RatingsConfig.overlayCacheMaxEntries)) {
        const size = bytes({ [key]: entry });
        if (size > remaining) continue;
        entries[key] = entry; remaining -= size;
      }
      const index = [];
      remaining = 200_000;
      for (const item of value.index.slice(-root.RatingsConfig.listIndexMaxEntries).reverse()) {
        const size = bytes(item) + 1;
        if (size > remaining) continue;
        index.push(item); remaining -= size;
      }
      return { ...value, entries, index: index.reverse() };
    },
    overlayCachesFromStorage(local, epoch) {
      const caches = {};
      const records = local[SITES_KEY];
      const candidates = records && typeof records === 'object' && !Array.isArray(records) ? Object.values(records) : [];
      // A legacy cache is migrated even when a different site is active.
      if (local[KEY]) candidates.unshift(local[KEY]);
      for (const value of candidates) {
        try {
          const key = serverKey(value.server);
          const clean = this.sanitizeOverlayCache(value, value.server, epoch);
          if (clean) {
            const bounded = this.boundedOverlayCache(clean);
            const previous = caches[key];
            // Older storage versions could serialize the same server under
            // both trailing-slash forms. Merge equivalent records per title
            // so a newer duplicate cannot discard ratings unique to an older
            // tab. A matcher change still invalidates old entries; retain the
            // freshest whole record until the current rules repopulate it.
            if (!previous) caches[key] = bounded;
            else if (previous.matcher === bounded.matcher) {
              caches[key] = this.boundedOverlayCache(this.mergeOverlayCache(previous, bounded, [], {}, []));
            } else if (cacheFreshness(bounded) >= cacheFreshness(previous)) {
              caches[key] = bounded;
            }
          }
        } catch (_) { /* Invalid generated cache records can be refetched. */ }
      }
      return boundedSiteCaches(caches);
    },
    mergeOverlayRating(previous, incoming, expected = null) {
      if (!previous) return incoming;
      // Persist native deletions so an older discovery cannot fill them back
      // in after a worker restart. A newer scored value retires its marker.
      const removals = {};
      for (const field of ['imdbRating', 'tmdbRating']) {
        const removedAt = Math.max(previous.nativeRemovedAt?.[field] ?? 0, incoming.nativeRemovedAt?.[field] ?? 0);
        if (removedAt) removals[field] = removedAt;
        if (expected?.bundle?.[field] != null && incoming.bundle?.[field] == null &&
            (incoming.cachedAt ?? 0) >= (previous.cachedAt ?? 0)) {
          removals[field] = Math.max(removedAt, incoming.cachedAt ?? 0);
        }
      }
      const finish = entry => {
        const nativeRemovedAt = Object.fromEntries(Object.entries(removals).filter(([field]) => entry.bundle?.[field] == null));
        const { nativeRemovedAt: ignored, ...value } = entry;
        return { ...value, ...(Object.keys(nativeRemovedAt).length ? { nativeRemovedAt } : {}) };
      };
      let newerServer = (incoming.cachedAt ?? 0) >= (previous.cachedAt ?? 0) ? incoming : previous;
      // Millisecond timestamps can tie across tabs. A public reconciliation
      // still carries its original native snapshot: it must not undo native
      // data or retry metadata another tab saved in that same clock tick.
      if (expected && incoming.cachedAt === previous.cachedAt && incoming.cachedAt === expected.cachedAt &&
          incoming.publicCheckedAt > (expected.publicCheckedAt ?? 0) &&
          ['imdbRating', 'tmdbRating'].every(field => (incoming.bundle?.[field] ?? null) === (expected.bundle?.[field] ?? null)) &&
          (['imdbRating', 'tmdbRating'].some(field => (previous.bundle?.[field] ?? null) !== (expected.bundle?.[field] ?? null)) ||
            previous.retryAt !== expected.retryAt || JSON.stringify(previous.diagnostics) !== JSON.stringify(expected.diagnostics))) {
        newerServer = previous;
      }
      const other = newerServer === incoming ? previous : incoming;
      // Two tabs can discover different missing native scores. An unchanged
      // absence in their common snapshot (including a cold or unrated load)
      // is not a deletion of the other tab's contribution. Explicit changes
      // from a known score stay ordered by the server timestamp, including
      // intentional removals.
      if (newerServer.bundle && other.bundle) {
        const additions = Object.fromEntries(['imdbRating', 'tmdbRating'].filter(field =>
          expected?.bundle?.[field] == null && newerServer.bundle[field] == null && other.bundle[field] != null &&
          (other.cachedAt ?? 0) > (removals[field] ?? -1)
        ).map(field => [field, other.bundle[field]]));
        if (Object.keys(additions).length) {
          const bundle = { ...newerServer.bundle, ...additions };
          const verifiedRt = bundle.confidence >= root.RatingsConfig.confidenceThreshold &&
            ['rtCriticsScore', 'rtAudienceScore'].some(field => bundle[field] != null);
          const complete = ['rtCriticsScore', 'rtAudienceScore', 'imdbRating', 'tmdbRating'].every(field => bundle[field] != null);
          const status = newerServer.diagnostics?.status === 'failed' ? 'failed'
            : newerServer.diagnostics?.status === 'uncertain' && !verifiedRt ? 'uncertain'
            : complete && verifiedRt ? 'rated' : 'partial';
          newerServer = { ...newerServer, bundle,
            ...(newerServer.diagnostics ? { diagnostics: { ...newerServer.diagnostics, status } } : {}) };
        }
      }
      // Public RT can advance without refreshing this server's IMDb/TMDB.
      // Its age is independent of the server snapshot. If that snapshot is
      // newer but has never adopted public data, let an unexpired public
      // result fill missing RT fields while preserving native values.
      const rtFields = ['rtCriticsScore', 'rtAudienceScore'];
      const sharedIsNewer = other.publicCheckedAt > (newerServer.publicCheckedAt ?? 0);
      const sharedPredatesNative = sharedIsNewer && newerServer.publicCheckedAt == null &&
        other.publicCheckedAt <= (newerServer.cachedAt ?? 0);
      const sharedFillsGap = sharedPredatesNative && rtFields.some(field =>
        newerServer.bundle?.[field] == null && other.bundle?.[field] != null);
      if (!other.bundle || !rtFields.some(field => other.bundle[field] != null) ||
          !sharedIsNewer || (sharedPredatesNative && !sharedFillsGap)) return finish(newerServer);
      const preferShared = !sharedPredatesNative;
      const contributors = rtFields.flatMap(field => {
        if (preferShared && other.bundle[field] != null) return [other.bundle];
        if (newerServer.bundle?.[field] != null) return [newerServer.bundle];
        return other.bundle[field] != null ? [other.bundle] : [];
      });
      const bundle = { ...newerServer.bundle,
        rtCriticsScore: preferShared
          ? other.bundle.rtCriticsScore ?? newerServer.bundle?.rtCriticsScore ?? null
          : newerServer.bundle?.rtCriticsScore ?? other.bundle.rtCriticsScore ?? null,
        rtAudienceScore: preferShared
          ? other.bundle.rtAudienceScore ?? newerServer.bundle?.rtAudienceScore ?? null
          : newerServer.bundle?.rtAudienceScore ?? other.bundle.rtAudienceScore ?? null,
        confidence: contributors.length ? Math.min(...contributors.map(value => value.confidence ?? 0)) : 0,
        source: (preferShared ? other.bundle.source : newerServer.bundle?.source) || other.bundle.source,
        lastUpdated: Math.max(number(other.bundle.lastUpdated) ?? 0, number(newerServer.bundle?.lastUpdated) ?? 0) || null };
      const publicExpiresAt = other.publicCheckedAt + root.RatingsConfig.rtCacheTtlMs;
      const nativeComplete = ['rtCriticsScore', 'rtAudienceScore', 'imdbRating', 'tmdbRating']
        .every(field => newerServer.bundle?.[field] != null);
      const nativeRetryAt = newerServer.retryAt ?? ((newerServer.cachedAt ?? 0) +
        (nativeComplete ? root.RatingsConfig.ratingsFreshMs : root.RatingsConfig.partialRatingsRetryMs));
      const verifiedRt = bundle.confidence >= root.RatingsConfig.confidenceThreshold && rtFields.some(field => bundle[field] != null);
      const complete = ['rtCriticsScore', 'rtAudienceScore', 'imdbRating', 'tmdbRating'].every(field => bundle[field] != null);
      const diagnosticStatus = newerServer.diagnostics?.status === 'failed' ? 'failed'
        : newerServer.diagnostics?.status === 'uncertain' && !verifiedRt ? 'uncertain'
        : complete && verifiedRt ? 'rated' : 'partial';
      return finish({ ...newerServer, bundle,
        publicCheckedAt: Math.max(newerServer.publicCheckedAt ?? 0, other.publicCheckedAt),
        // An already expired fallback must not defeat a failed-read backoff.
        ...(publicExpiresAt > Date.now() ? { retryAt: Math.min(nativeRetryAt, publicExpiresAt) } : {}),
        ...(newerServer.diagnostics ? { diagnostics: { ...newerServer.diagnostics, status: diagnosticStatus, source: bundle.source } } : {}) });
    },
    mergeOverlayCache(previous, incoming, removed, expectedEntries = {}, expectedIndex = []) {
      const entries = previous?.matcher === incoming.matcher ? { ...previous.entries } : {};
      const removals = (Array.isArray(removed) ? removed : []).slice(-root.RatingsConfig.overlayCacheMaxEntries);
      // Compare canonical records: the bridge sanitizes saved values, while
      // the tab's snapshot can omit null fields added during sanitization.
      const expected = this.sanitizeOverlayCache({ ...incoming, index: [], entries: Object.fromEntries(
        removals.filter(item => item?.expected).map(item => [item.key, item.expected])) }, incoming.server, incoming.epoch).entries;
      // Removal clocks are worker bookkeeping added after the tab's write.
      // They must not prevent that tab from forgetting otherwise unchanged
      // ratings. Compare all score, retry and diagnostic data as before.
      const comparable = entry => JSON.stringify({ ...entry, nativeRemovedAt: undefined });
      for (const item of removals) {
        if (item && entries[item.key] && entries[item.key].cachedAt === item.cachedAt &&
            (entries[item.key].publicCheckedAt ?? null) === (item.publicCheckedAt ?? null) &&
            // Older clients send timestamps only. New clients also protect
            // same-time score changes and retry/diagnostic updates.
            (!Object.hasOwn(item, 'expected') || (expected[item.key] &&
              comparable(entries[item.key]) === comparable(expected[item.key])))) delete entries[item.key];
      }
      const bases = this.sanitizeOverlayCache({ ...incoming, index: [], entries: expectedEntries }, incoming.server, incoming.epoch).entries;
      for (const [key, entry] of Object.entries(incoming.entries)) {
        entries[key] = this.mergeOverlayRating(entries[key], entry, bases[key]);
      }
      const indexBases = this.sanitizeOverlayCache({ ...incoming, entries: {}, index: expectedIndex }, incoming.server, incoming.epoch).index;
      const indexExpected = new Map(indexBases.map(item => [`${item.mediaType}:${item.tmdbId}`, item]));
      const index = new Map((previous?.index || []).map(item => [`${item.mediaType}:${item.tmdbId}`, item]));
      for (const item of incoming.index) {
        const key = `${item.mediaType}:${item.tmdbId}`;
        // Catalogue observations can be partial (for example request rows
        // with a title but no poster). Match the tab's gap-filling policy so
        // another tab's complementary metadata survives the shared write.
        const previousItem = index.get(key);
        const base = indexExpected.get(key);
        const merged = { ...item };
        // A changed poster must not replay an unchanged stale title/year over
        // another tab's correction. Explicitly changed fields still win.
        for (const field of ['title', 'originalTitle', 'posterPath', 'releaseDate', 'firstAirDate', 'year']) {
          if (previousItem && base && item[field] === base[field]) merged[field] = previousItem[field];
        }
        for (const field of ['title', 'originalTitle', 'posterPath', 'releaseDate', 'firstAirDate']) {
          if (!merged[field] && previousItem?.[field]) merged[field] = previousItem[field];
        }
        if (merged.year == null && previousItem?.year != null) merged.year = previousItem.year;
        index.delete(key); index.set(key, merged);
      }
      return { ...incoming, entries, index: [...index.values()].slice(-root.RatingsConfig.listIndexMaxEntries) };
    },
    async getOverlayCache(sender) {
      const server = this.overlayStorageServer(sender);
      await this.cacheClearPending;
      await this.loadRtCache();
      return this.queueOverlayStorage(async () => {
        if (server !== this.overlayStorageServer(sender)) throw new Error('Server changed');
        const local = await chrome.storage.local.get([KEY, SITES_KEY, 'ratingsCacheEpoch']);
        if (server !== this.overlayStorageServer(sender)) throw new Error('Server changed');
        const epoch = local.ratingsCacheEpoch ?? 0;
        const caches = this.overlayCachesFromStorage(local, epoch);
        if (local[KEY]) {
          // Retire the legacy payload atomically without signaling a cache
          // clear to older open tabs (which observe removal/undefined).
          await chrome.storage.local.set({ [SITES_KEY]: caches, [KEY]: null });
          if (server !== this.overlayStorageServer(sender)) throw new Error('Server changed');
        }
        const cached = caches[serverKey(server)];
        return { ratingsCacheEpoch: epoch, [KEY]: cached ? { ...cached, server } : null, publicRatingsV1: this.publicRatingsPayload() };
      });
    },
    async putOverlayCache(value, sender) {
      const server = this.overlayStorageServer(sender);
      await this.cacheClearPending;
      return this.queueOverlayStorage(async () => {
        const local = await chrome.storage.local.get([KEY, SITES_KEY, 'ratingsCacheEpoch']);
        if (server !== this.overlayStorageServer(sender)) throw new Error('Server changed');
        const clean = this.sanitizeOverlayCache(value, server, local.ratingsCacheEpoch ?? 0);
        if (!clean) return { stored: false };
        const caches = this.overlayCachesFromStorage(local, local.ratingsCacheEpoch ?? 0);
        const key = serverKey(server);
        const merged = value.delta === true ? this.mergeOverlayCache(caches[key], clean, value.removed, value.expectedEntries, value.expectedIndex) : clean;
        const bounded = this.boundedOverlayCache(merged);
        // Validate the server and clear epoch above even for empty deltas.
        // Identical results need no write, but legacy payloads still need
        // retirement so they cannot reappear after a later cache eviction.
        if (!local[KEY] && JSON.stringify(local[SITES_KEY]?.[key]) === JSON.stringify(bounded)) return { stored: true };
        delete caches[key];
        caches[key] = bounded;
        await chrome.storage.local.set({ [SITES_KEY]: boundedSiteCaches(caches), [KEY]: null });
        return { stored: true };
      });
    },
    async notifyPopupState() {
      // Extension pages do not receive tabs.sendMessage. Broadcast only after
      // settings have loaded; a raw storage event can precede that reload.
      try { await chrome.runtime.sendMessage?.({ action: 'seerrConfigChanged' }); }
      catch (_) { /* No popup or Settings page may be open. */ }
    },
    async notifyContentState(cacheCleared = false, publicRatingsChanged = false) {
      if (!cacheCleared && !publicRatingsChanged) void this.notifyPopupState();
      if (!chrome.tabs?.query || !chrome.tabs?.sendMessage) return;
      const tabs = await chrome.tabs.query({});
      await Promise.allSettled(tabs.filter(tab => Number.isInteger(tab.id)).map(tab =>
        chrome.tabs.sendMessage(tab.id, publicRatingsChanged ? { action: 'publicRatingsChanged' } : { action: 'seerrStateChanged', cacheCleared })
      ));
    }
  };
})(globalThis);

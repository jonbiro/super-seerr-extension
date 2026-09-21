// The configured Seerr page can exchange only its bounded ratings cache.
(function (root) {
  const KEY = 'overlayRatingsV1';
  const text = (value, max = 300) => typeof value === 'string' ? value.slice(0, max) : '';
  const number = (value, max = Infinity) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : null;
  root.OverlayStorage = {
    async restrictLocalStorage() {
      if (!chrome.storage.local.setAccessLevel) return false;
      await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
      return true;
    },
    overlayStorageServer(sender) {
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
      for (const [key, entry] of Object.entries(value.entries || {}).slice(-root.RatingsConfig.overlayCacheMaxEntries)) {
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
        entries[key] = { bundle, cachedAt: number(entry.cachedAt, Date.now() + 60000), retryAt: number(entry.retryAt, Date.now() + root.RatingsConfig.ratingsFreshMs), diagnostics };
      }
      const index = (Array.isArray(value.index) ? value.index : []).slice(-root.RatingsConfig.listIndexMaxEntries).filter(item =>
        item && /^(movie|tv)$/.test(item.mediaType) && /^[1-9]\d*$/.test(String(item.tmdbId)) && Number.isSafeInteger(Number(item.tmdbId))
      ).map(item => ({ tmdbId: String(item.tmdbId), mediaType: item.mediaType, title: text(item.title), originalTitle: text(item.originalTitle),
        year: number(item.year, 9999), posterPath: text(item.posterPath, 500) || null, releaseDate: text(item.releaseDate, 20), firstAirDate: text(item.firstAirDate, 20) }));
      return { server, epoch, matcher: number(value.matcher), entries, index };
    },
    async getOverlayCache(sender) {
      const server = this.overlayStorageServer(sender);
      await this.cacheClearPending;
      return this.queueOverlayStorage(async () => {
        if (server !== this.overlayStorageServer(sender)) throw new Error('Server changed');
        const local = await chrome.storage.local.get([KEY, 'ratingsCacheEpoch']);
        const epoch = local.ratingsCacheEpoch ?? 0;
        return { ratingsCacheEpoch: epoch, [KEY]: this.sanitizeOverlayCache(local[KEY], server, epoch) };
      });
    },
    async putOverlayCache(value, sender) {
      const server = this.overlayStorageServer(sender);
      await this.cacheClearPending;
      return this.queueOverlayStorage(async () => {
        const local = await chrome.storage.local.get('ratingsCacheEpoch');
        if (server !== this.overlayStorageServer(sender)) throw new Error('Server changed');
        const clean = this.sanitizeOverlayCache(value, server, local.ratingsCacheEpoch ?? 0);
        if (!clean) return { stored: false };
        await chrome.storage.local.set({ [KEY]: clean });
        return { stored: true };
      });
    },
    async notifyContentState(cacheCleared = false) {
      if (!chrome.tabs?.query || !chrome.tabs?.sendMessage) return;
      const tabs = await chrome.tabs.query({});
      await Promise.allSettled(tabs.filter(tab => Number.isInteger(tab.id)).map(tab =>
        chrome.tabs.sendMessage(tab.id, { action: 'seerrStateChanged', cacheCleared })
      ));
    }
  };
})(globalThis);

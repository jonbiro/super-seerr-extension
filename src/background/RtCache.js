// Focused worker methods; composed onto SeerrAPI by background.js.
(function (root) {
  const RatingsConfig = root.RatingsConfig;
  const RT_CACHE_STORAGE_KEY = 'rtCacheV1';
  const RT_CACHE_FLUSH_DELAY_MS = 500;
  root.RtCache = {
    clearRatingsCache() {
      if (this.cacheClearPending) return this.cacheClearPending;
      ++this.rtCacheGeneration;
      clearTimeout(this.rtCacheFlushTimer);
      this.rtCacheFlushTimer = null;
      this.rtCache.clear();
      this.rtPending.clear();
      this.rtCacheReady = null;
      this.cacheClearPending = (async () => {
        // Let any storage write already in progress finish before removal.
        await this.rtCacheFlushing;
        await chrome.storage.local.remove(['rtCacheV1', 'seerrRatingsUnavailableV1', 'overlayRatingsV1']);
        // A marker also reaches tabs whose persisted cache was already absent.
        await chrome.storage.local.set({ ratingsCacheEpoch: `${Date.now()}:${Math.random()}` });
      })().finally(() => { this.cacheClearPending = null; });
      return this.cacheClearPending;
    },

    cacheRottenTomatoesResult(key, value, ttl, generation = this.rtCacheGeneration) {
      if (generation !== this.rtCacheGeneration) return;
      this.rtCache.delete(key);
      while (this.rtCache.size >= RatingsConfig.rtCacheMaxEntries) this.rtCache.delete(this.rtCache.keys().next().value);
      this.rtCache.set(key, { value, expiresAt: Date.now() + ttl });
      this.scheduleRtCacheFlush();
    },

    // ── Persisted RT cache ──
    // The worker is evicted after seconds of idle, so an in-memory Map alone can
    // never honour rtCacheTtlMs. storage.local carries entries across restarts.

    loadRtCache() {
      const generation = this.rtCacheGeneration;
      this.rtCacheReady ??= (async () => {
        // A clear already under way has emptied memory but may not have reached
        // storage yet. Reading before it does restores exactly what is being
        // deleted, and the next flush writes it back, so the clear leaves no
        // trace. The generation captured above still covers the other order: a
        // clear that starts after this read began.
        await this.cacheClearPending;
        try {
          const stored = (await chrome.storage.local.get([RT_CACHE_STORAGE_KEY]))[RT_CACHE_STORAGE_KEY];
          if (generation !== this.rtCacheGeneration || !stored || typeof stored !== 'object') return;
          // A stored result carries the confidence its match earned. Scored under
          // rules we no longer use, it would keep that verdict for a full day
          // after the rules changed, however the matcher would judge it now.
          if (stored.matcher !== RatingsConfig.matcherVersion) {
            this.log('The title-matching rules have changed; discarding cached Rotten Tomatoes results');
            return;
          }
          const now = Date.now();
          for (const [key, entry] of Object.entries(stored.entries || {})) {
            // A live in-memory entry is newer than anything on disk.
            if (this.rtCache.has(key)) continue;
            if (!entry || typeof entry !== 'object' || typeof entry.expiresAt !== 'number') continue;
            if (now >= entry.expiresAt) continue;
            this.rtCache.set(key, { value: entry.value ?? null, expiresAt: entry.expiresAt });
          }
        } catch (error) {
          console.error('Could not read the persisted Rotten Tomatoes cache:', error);
        }
      })();
      return this.rtCacheReady;
    },

    scheduleRtCacheFlush() {
      if (this.rtCacheFlushTimer !== null) return;
      this.rtCacheFlushTimer = setTimeout(() => {
        this.rtCacheFlushTimer = null;
        this.flushRtCache();
      }, RT_CACHE_FLUSH_DELAY_MS);
    },

    // Serialised so overlapping flushes cannot interleave their writes.
    // Also coalesces a debounced write already waiting: flushing now covers it.
    flushRtCache() {
      const generation = this.rtCacheGeneration;
      if (this.rtCacheFlushTimer !== null) {
        clearTimeout(this.rtCacheFlushTimer);
        this.rtCacheFlushTimer = null;
      }      this.rtCacheFlushing = (this.rtCacheFlushing ?? Promise.resolve()).then(async () => {
        if (generation !== this.rtCacheGeneration) return;
        try {
          const now = Date.now();
          const payload = {};
          for (const [key, entry] of this.rtCache) {
            if (now < entry.expiresAt) payload[key] = entry;
          }
          await chrome.storage.local.set({
            [RT_CACHE_STORAGE_KEY]: { matcher: RatingsConfig.matcherVersion, entries: payload }
          });
        } catch (error) {
          console.error('Could not persist the Rotten Tomatoes cache:', error);
        }
      });
      return this.rtCacheFlushing;
    },
  };
})(globalThis);

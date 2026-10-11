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
      this.publicRatings.clear();
      this.rtPending.clear();
      this.rtCacheReady = null;
      this.cacheClearPending = this.queueOverlayStorage(async () => {
        // Let any storage write already in progress finish before removal.
        await this.rtCacheFlushing;
        await chrome.storage.local.remove(['rtCacheV1', 'publicRatingsV1', 'seerrRatingsUnavailableV1', 'overlayRatingsV1', 'overlayRatingsByServerV1']);
        // A marker also reaches tabs whose persisted cache was already absent.
        await chrome.storage.local.set({ ratingsCacheEpoch: `${Date.now()}:${Math.random()}` });
      }).finally(() => { this.cacheClearPending = null; void this.notifyContentState(true).catch(() => {}); });
      return this.cacheClearPending;
    },

    cacheRottenTomatoesResult(key, value, ttl, generation = this.rtCacheGeneration, diagnostic = null, checkedAt = Date.now()) {
      if (generation !== this.rtCacheGeneration || (this.rtCache.get(key)?.checkedAt ?? 0) > checkedAt) return;
      this.rtCache.delete(key);
      while (this.rtCache.size >= RatingsConfig.rtCacheMaxEntries) this.rtCache.delete(this.rtCache.keys().next().value);
      this.rtCache.set(key, { value, expiresAt: checkedAt + ttl, checkedAt, diagnostic });
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
          const local = await chrome.storage.local.get([RT_CACHE_STORAGE_KEY, 'publicRatingsV1']);
          const stored = local[RT_CACHE_STORAGE_KEY];
          if (generation !== this.rtCacheGeneration) return;
          const shared = local.publicRatingsV1;
          if (shared?.matcher === RatingsConfig.matcherVersion) {
            for (const [key, value] of Object.entries(shared.entries || {}).slice(0, RatingsConfig.rtCacheMaxEntries)
              .sort((a, b) => (a[1]?.checkedAt || 0) - (b[1]?.checkedAt || 0))) {
              const [mediaType, tmdbId] = key.split(':');
              if (key !== this.publicRatingKey({ mediaType, tmdbId })) continue;
              const clean = this.sanitizePublicRating(value, mediaType);
              if (clean && !this.publicRatings.has(key)) {
                this.publicRatings.set(key, clean);
                this.rtLookupClock = Math.max(this.rtLookupClock, clean.checkedAt);
              }
            }
          }
          if (generation !== this.rtCacheGeneration || !stored || typeof stored !== 'object') return;
          // A stored result carries the confidence its match earned. Scored under
          // rules we no longer use, it would keep that verdict for a full day
          // after the rules changed, however the matcher would judge it now.
          if (stored.matcher !== RatingsConfig.matcherVersion) {
            this.log('The title-matching rules have changed; discarding cached Rotten Tomatoes results');
            return;
          }
          const now = Date.now();
          for (const [key, entry] of Object.entries(stored.entries || {}).slice(0, RatingsConfig.rtCacheMaxEntries)
            .sort((a, b) => (a[1]?.expiresAt || 0) - (b[1]?.expiresAt || 0))) {
            // A live in-memory entry is newer than anything on disk.
            if (this.rtCache.has(key)) continue;
            if (!entry || typeof entry !== 'object' || typeof entry.expiresAt !== 'number') continue;
            const checkedAt = entry.checkedAt ?? entry.expiresAt - RatingsConfig.rtCacheTtlMs;
            const diagnostic = ['uncertain', 'failed', 'unrated', 'rated'].includes(entry.diagnostic) ? entry.diagnostic : null;
            // Older versions kept failed detail reads for an hour. Honor the
            // short failure backoff on upgrade as well as for new results.
            const expiresAt = diagnostic === 'failed'
              ? Math.min(entry.expiresAt, checkedAt + RatingsConfig.inconclusiveRetryMs) : entry.expiresAt;
            if (now >= expiresAt) continue;
            this.rtCache.set(key, { value: entry.value ?? null, expiresAt, checkedAt, diagnostic });
          }
        } catch (error) {
          if (generation === this.rtCacheGeneration) this.rtCacheReady = null;
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
      }
      this.rtCacheFlushing = (this.rtCacheFlushing ?? Promise.resolve()).then(async () => {
        if (generation !== this.rtCacheGeneration) return;
        try {
          const now = Date.now();
          const payload = {};
          // Together with ten per-site caches and the public tier, leave room
          // for settings within the browser's default local-storage quota.
          let remaining = 1_000_000;
          for (const [key, entry] of [...this.rtCache].sort((a, b) => b[1].expiresAt - a[1].expiresAt)) {
            if (now >= entry.expiresAt) continue;
            const size = new TextEncoder().encode(JSON.stringify({ [key]: entry })).length;
            if (size > remaining) continue;
            payload[key] = entry; remaining -= size;
          }
          const publicPayload = this.publicRatingsPayload();
          await chrome.storage.local.set({
            [RT_CACHE_STORAGE_KEY]: { matcher: RatingsConfig.matcherVersion, entries: payload },
            publicRatingsV1: publicPayload
          });
          const fingerprint = JSON.stringify(publicPayload);
          if (generation === this.rtCacheGeneration && fingerprint !== this.publicRatingsNotified) {
            this.publicRatingsNotified = fingerprint;
            // No scores, catalogue data or credentials are broadcast. Each
            // authorized Seerr tab reads the public tier through its bridge.
            void this.notifyContentState(false, true).catch(() => {});
          }
        } catch (error) {
          console.error('Could not persist the Rotten Tomatoes cache:', error);
        }
      });
      return this.rtCacheFlushing;
    },
  };
})(globalThis);

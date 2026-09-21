// Short-lived, bounded reads shared across tabs. Writes are never cached or retried.
(function (root) {
  root.SeerrReadCache = {
    invalidateSeerrReads() {
      this.seerrReadGeneration = (this.seerrReadGeneration || 0) + 1;
      this.seerrReads = new Map();
    },

    cachedSeerrRead(key, loader, ttlMs = 15000) {
      this.seerrReads ??= new Map();
      const entries = this.seerrReads;
      const existing = entries.get(key);
      if (existing && (existing.pending || existing.expiresAt > Date.now())) return existing.promise;
      const generation = this.seerrReadGeneration || 0;
      const entry = { pending: true, expiresAt: 0, promise: null };
      entry.promise = Promise.resolve().then(loader).then(value => {
        // Errors represented as status objects must be retryable immediately.
        if (generation !== (this.seerrReadGeneration || 0) || value?.status === 'error') {
          if (entries.get(key) === entry) entries.delete(key);
        } else {
          entry.pending = false;
          entry.expiresAt = Date.now() + ttlMs;
        }
        return value;
      }, error => {
        if (entries.get(key) === entry) entries.delete(key);
        throw error;
      });
      entries.delete(key);
      entries.set(key, entry);
      // Eviction does not cancel the caller's promise or resend a write.
      while (entries.size > 200) entries.delete(entries.keys().next().value);
      return entry.promise;
    }
  };
})(globalThis);

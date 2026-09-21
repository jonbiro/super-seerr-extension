// Device-local history of confirmed actions. Never stores request bodies or errors.
(function (root) {
  const KEY = 'recentActionsV1';
  const kinds = new Set(['request', 'seerr-watchlist', 'plex-watchlist']);
  function clean(entry) {
    if (!entry || !kinds.has(entry.kind) || !['movie', 'tv'].includes(entry.mediaType) ||
        !Number.isFinite(entry.at) || typeof entry.title !== 'string') return null;
    const result = { kind: entry.kind, mediaType: entry.mediaType, title: entry.title.slice(0, 200), at: entry.at };
    try {
      const url = new URL(entry.server);
      if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && Number.isSafeInteger(entry.tmdbId) && entry.tmdbId > 0) {
        result.server = url.href; result.tmdbId = entry.tmdbId;
      }
    } catch (_) { /* Older history has no stable identity. */ }
    return result;
  }
  root.RecentActions = {
    requireExtensionPage(sender) {
      const prefix = chrome.runtime.getURL('');
      if (typeof sender?.url !== 'string' || !sender.url.startsWith(prefix)) {
        throw new Error('This action is available only in extension pages');
      }
    },
    queueRecentAction(operation) {
      const task = (this.recentActionQueue || Promise.resolve()).then(operation);
      this.recentActionQueue = task.catch(() => {});
      return task;
    },
    async getRecentActions() {
      await this.recentActionQueue;
      const value = (await chrome.storage.local.get(KEY))[KEY];
      return Array.isArray(value) ? value.slice(0, 50).map(clean).filter(Boolean) : [];
    },
    async getRecentActionStatuses() {
      const server = this.baseUrl;
      const rows = await this.getRecentActions();
      const results = new Array(rows.length); let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(4, rows.length) }, async () => {
        while (cursor < rows.length) {
          const index = cursor++, entry = rows[index];
          const result = { at: entry.at, title: entry.title, mediaType: entry.mediaType, status: 'Status unavailable', url: null };
          if (server && entry.server === new URL(server).href && entry.tmdbId) {
            result.url = `${server.replace(/\/$/, '')}/${entry.mediaType}/${entry.tmdbId}`;
            try {
              const state = await this.getMediaStatus({ tmdbId: entry.tmdbId, mediaType: entry.mediaType });
              const labels = { available_watch: 'Available', available: 'Not requested', pending: 'Pending approval', requested: 'Requested', downloading: 'Processing', partial: 'Partially available', declined: 'Declined', failed: 'Failed' };
              result.status = labels[state.status] || 'Status unavailable';
            } catch (_) { /* Keep the confirmed historical action even offline. */ }
          }
          results[index] = result;
        }
      }));
      if (server !== this.baseUrl) throw new Error('Server changed. Refresh history.');
      return results;
    },
    clearRecentActions() {
      return this.queueRecentAction(() => chrome.storage.local.remove(KEY));
    },
    async recordRecentAction(kind, media) {
      // A history storage failure must never turn a confirmed write into a
      // reported request failure, which could prompt an accidental duplicate.
      try {
        let title = String(media.title || 'Untitled').replace(/[\u0000-\u001f\u007f]/g, ' ');
        for (const secret of [this.apiKey, this.plexToken]) {
          if (secret) title = title.split(secret).join('[redacted]');
        }
        const entry = clean({ kind, mediaType: media.mediaType, title, at: Date.now(), tmdbId: Number(media.tmdbId), server: media.historyServer || this.baseUrl });
        if (!entry) return;
        await this.queueRecentAction(async () => {
          const stored = (await chrome.storage.local.get(KEY))[KEY];
          const previous = Array.isArray(stored) ? stored.slice(0, 49).map(clean).filter(Boolean) : [];
          await chrome.storage.local.set({ [KEY]: [entry, ...previous] });
        });
      } catch (_) { /* The server action already succeeded. */ }
    }
  };
})(globalThis);

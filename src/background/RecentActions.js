// Device-local history of confirmed actions. Never stores request bodies or errors.
(function (root) {
  const KEY = 'recentActionsV1';
  const kinds = new Set(['request', 'seerr-watchlist', 'plex-watchlist']);
  function clean(entry) {
    if (!entry || !kinds.has(entry.kind) || !['movie', 'tv'].includes(entry.mediaType) ||
        !Number.isFinite(entry.at) || typeof entry.title !== 'string') return null;
    return { kind: entry.kind, mediaType: entry.mediaType, title: entry.title.slice(0, 200), at: entry.at };
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
        const entry = clean({ kind, mediaType: media.mediaType, title, at: Date.now() });
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

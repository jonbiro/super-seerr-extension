// Explicit, device-local choices. A saved ID must still appear in a fresh,
// title/type/year-validated candidate list before it can be applied.
(function (root) {
  const KEY = 'titleCorrectionsV1';
  root.TitleCorrections = {
    correctionKey(data) {
      const media = root.MediaValidation.media(data);
      return JSON.stringify([new URL(this.baseUrl).href, media.mediaType, media.title.slice(0, 300), media.year, String(media.imdbId || '').slice(0, 30)]);
    },
    async getTitleCorrections() {
      const rows = (await chrome.storage.local.get(KEY))[KEY];
      return Array.isArray(rows) ? rows.filter(row => typeof row?.key === 'string' && typeof row.title === 'string' && Number.isSafeInteger(row.tmdbId)).slice(0, 200) : [];
    },
    beginTitleCorrectionChange(key) {
      this.pendingTitleCorrectionChanges ??= new Set();
      const change = { key, obsolete: false };
      this.pendingTitleCorrectionChanges.add(change);
      return change;
    },
    commitTitleCorrectionChange(change) {
      // Set order follows user intent. A confirmed change revokes only older
      // pending changes for this key, without canceling newer or other choices.
      for (const pending of this.pendingTitleCorrectionChanges) {
        if (pending === change) break;
        if (pending.key === change.key) pending.obsolete = true;
      }
      this.titleCorrectionGeneration = (this.titleCorrectionGeneration || 0) + 1;
      this.invalidateSeerrReads();
    },
    async saveTitleCorrection(data) {
      const key = this.correctionKey(data.original);
      const change = this.beginTitleCorrectionChange(key);
      try {
        const server = this.baseUrl;
        const apiKey = this.apiKey;
        const token = this.connectionToken();
        const assertCurrent = () => {
          if (change.obsolete) throw new Error('Saved match changed. Choose the title again.');
          if (server !== this.baseUrl || apiKey !== this.apiKey || token !== this.connectionToken()) {
            throw new Error('Settings changed. Choose the title again.');
          }
        };
        const selected = (await this.getMediaCandidates(data.original)).find(row => row.tmdbId === data.tmdbId);
        assertCurrent();
        if (!selected) throw new Error('Match changed. Choose the title again.');
        return await this.queueRecentAction(async () => {
          assertCurrent();
          const rows = await this.getTitleCorrections();
          assertCurrent();
          const entry = { key, title: String(data.original.title).slice(0, 300), selectedTitle: selected.title, mediaType: selected.mediaType, tmdbId: selected.tmdbId, year: selected.year };
          await chrome.storage.local.set({ [KEY]: [entry, ...rows.filter(row => row.key !== key)].slice(0, 200) });
          this.commitTitleCorrectionChange(change);
        });
      } finally {
        this.pendingTitleCorrectionChanges.delete(change);
      }
    },
    async getSavedTitleCorrection(data) {
      if (!this.baseUrl) return null;
      const server = this.baseUrl;
      const apiKey = this.apiKey;
      const token = this.connectionToken();
      const generation = this.titleCorrectionGeneration || 0;
      const isCurrent = () => server === this.baseUrl && apiKey === this.apiKey && token === this.connectionToken()
        && generation === (this.titleCorrectionGeneration || 0);
      const key = this.correctionKey(data);
      const saved = (await this.getTitleCorrections()).find(row => row.key === key);
      if (!saved || !isCurrent()) return null;
      const selected = (await this.getMediaCandidates(data)).find(row => row.tmdbId === saved.tmdbId);
      return isCurrent() ? selected || null : null;
    },
    removeTitleCorrection(key) {
      const change = this.beginTitleCorrectionChange(key);
      return this.queueRecentAction(async () => {
        const rows = await this.getTitleCorrections();
        await chrome.storage.local.set({ [KEY]: rows.filter(row => row.key !== key) });
        this.commitTitleCorrectionChange(change);
      }).finally(() => { this.pendingTitleCorrectionChanges.delete(change); });
    }
  };
})(globalThis);

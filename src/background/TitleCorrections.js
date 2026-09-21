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
    async saveTitleCorrection(data) {
      const key = this.correctionKey(data.original);
      const server = this.baseUrl;
      const selected = (await this.getMediaCandidates(data.original)).find(row => row.tmdbId === data.tmdbId);
      if (!selected || server !== this.baseUrl) throw new Error('Match changed. Choose the title again.');
      return this.queueRecentAction(async () => {
        const rows = await this.getTitleCorrections();
        if (server !== this.baseUrl) throw new Error('Server changed. Choose the title again.');
        const entry = { key, title: String(data.original.title).slice(0, 300), selectedTitle: selected.title, mediaType: selected.mediaType, tmdbId: selected.tmdbId, year: selected.year };
        await chrome.storage.local.set({ [KEY]: [entry, ...rows.filter(row => row.key !== key)].slice(0, 200) });
        this.invalidateSeerrReads();
      });
    },
    async getSavedTitleCorrection(data) {
      if (!this.baseUrl) return null;
      const server = this.baseUrl;
      const key = this.correctionKey(data);
      const saved = (await this.getTitleCorrections()).find(row => row.key === key);
      if (!saved || server !== this.baseUrl) return null;
      const selected = (await this.getMediaCandidates(data)).find(row => row.tmdbId === saved.tmdbId);
      return server === this.baseUrl ? selected || null : null;
    },
    removeTitleCorrection(key) {
      return this.queueRecentAction(async () => {
        const rows = await this.getTitleCorrections();
        await chrome.storage.local.set({ [KEY]: rows.filter(row => row.key !== key) });
        this.invalidateSeerrReads();
      });
    }
  };
})(globalThis);

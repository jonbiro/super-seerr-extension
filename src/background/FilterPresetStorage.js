// One worker serializes read-modify-write operations from every Seerr tab.
(function (root) {
  const KEY = 'seerrFilterPresetsV1';
  const sorts = new Set(['default', 'score-desc', 'score-asc', 'rt-critics-desc', 'rt-critics-asc', 'rt-audience-desc', 'rt-audience-asc', 'tmdb-desc', 'tmdb-asc', 'imdb-desc', 'imdb-asc']);
  function clean(value) {
    if (!value || typeof value.name !== 'string' || !value.name.trim() || !sorts.has(value.sort)) return null;
    const filters = {};
    for (const [key, max] of Object.entries({ minCritics: 100, minAudience: 100, minTmdb: 10, minImdb: 10 })) {
      const number = Number(value.filters?.[key] ?? 0);
      if (!Number.isFinite(number)) return null;
      filters[key] = Math.max(0, Math.min(max, number));
    }
    return { name: value.name.trim().slice(0, 40), sort: value.sort, filters };
  }
  root.FilterPresetStorage = {
    filterPresetOperation(action, data, sender) {
      const server = this.overlayStorageServer(sender);
      const pending = (this.filterPresetQueue || Promise.resolve()).then(async () => {
        if (this.overlayStorageServer(sender) !== server) throw new Error('Server changed');
        const stored = (await chrome.storage.sync.get([KEY]))[KEY];
        const presets = Array.isArray(stored) ? stored.slice(0, 20).map(clean).filter(Boolean) : [];
        if (action === 'saveFilterPreset') {
          const preset = clean(data);
          if (!preset) throw new Error('Invalid filter preset');
          const index = presets.findIndex(item => item.name === preset.name);
          if (index >= 0) presets[index] = preset;
          else {
            if (presets.length >= 20) throw new Error('Delete a preset before adding another (maximum 20).');
            presets.push(preset);
          }
        } else if (action === 'deleteFilterPreset') {
          if (typeof data?.name !== 'string') throw new Error('Invalid preset name');
          for (let i = presets.length - 1; i >= 0; i--) if (presets[i].name === data.name) presets.splice(i, 1);
        } else if (action !== 'getFilterPresets') throw new Error('Invalid preset operation');
        if (this.overlayStorageServer(sender) !== server) throw new Error('Server changed');
        if (action !== 'getFilterPresets') await chrome.storage.sync.set({ [KEY]: presets });
        return presets;
      });
      this.filterPresetQueue = pending.catch(() => {});
      return pending;
    }
  };
})(globalThis);

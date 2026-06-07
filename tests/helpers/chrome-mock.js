// Lightweight in-memory mock for chrome.storage.sync
// Used by property tests to verify migration behaviour without a browser

function createStorageMock(initial = {}) {
  const store = { ...initial };
  return {
    get: (keys) => new Promise((resolve) => {
      const result = {};
      (Array.isArray(keys) ? keys : [keys]).forEach(k => {
        if (store[k] !== undefined) result[k] = store[k];
      });
      resolve(result);
    }),
    set: (items) => new Promise((resolve) => {
      Object.assign(store, items);
      resolve();
    }),
    remove: (keys) => new Promise((resolve) => {
      (Array.isArray(keys) ? keys : [keys]).forEach(k => delete store[k]);
      resolve();
    }),
    _dump: () => ({ ...store }),
    _reset: () => { Object.keys(store).forEach(k => delete store[k]); }
  };
}

module.exports = { createStorageMock };

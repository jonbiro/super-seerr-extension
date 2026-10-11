const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker } = require('./helpers/worker');

for (const mediaType of ['movie', 'tv']) for (const stage of ['storage', 'candidates']) {
  for (const mutation of ['forget', 'replace']) {
    test(`pending ${mediaType} saved-match ${stage} read rejects a confirmed ${mutation}`, async () => {
      const w = loadWorker({ get: async () => ({ seerrUrl: 'https://seerr.example' }) });
      await w.ready;
      const original = { title: 'The Thing', mediaType };
      const choices = [1, 2].map(tmdbId => ({ tmdbId, title: 'The Thing', mediaType }));
      w.api.getMediaCandidates = async () => choices;
      await w.api.saveTitleCorrection({ original, tmdbId: 1 });
      const key = w.localStore.titleCorrectionsV1[0].key;
      let finish, started, first = true;
      const entered = new Promise(resolve => { started = resolve; });
      const gate = new Promise(resolve => { finish = resolve; });
      const method = stage === 'storage' ? 'getTitleCorrections' : 'getMediaCandidates';
      const read = w.api[method].bind(w.api);
      w.api[method] = async (...args) => {
        const value = await read(...args);
        if (first) { first = false; started(); await gate; }
        return value;
      };
      const pending = w.api.getSavedTitleCorrection(original);
      await entered;
      if (mutation === 'forget') await w.api.removeTitleCorrection(key);
      else await w.api.saveTitleCorrection({ original, tmdbId: 2 });
      finish();
      assert.equal(await pending, null, 'the obsolete remembered choice must not be applied');
      w.api[method] = read;
      assert.equal((await w.api.getSavedTitleCorrection(original))?.tmdbId ?? null, mutation === 'forget' ? null : 2);
    });
  }
}

for (const mutation of ['forget', 'replace']) test(`failed ${mutation} preserves a pending saved choice`, async () => {
  const w = loadWorker({ get: async () => ({ seerrUrl: 'https://seerr.example' }) });
  await w.ready;
  const original = { title: 'The Thing', mediaType: 'movie' };
  const choices = [1, 2].map(tmdbId => ({ tmdbId, title: 'The Thing', mediaType: 'movie' }));
  w.api.getMediaCandidates = async () => choices;
  await w.api.saveTitleCorrection({ original, tmdbId: 1 });
  let finish, started, first = true;
  const entered = new Promise(resolve => { started = resolve; });
  w.api.getMediaCandidates = () => {
    if (!first) return Promise.resolve(choices);
    first = false; started(); return new Promise(resolve => { finish = () => resolve(choices); });
  };
  const pending = w.api.getSavedTitleCorrection(original);
  await entered;
  const storage = w.context.chrome.storage.local;
  const set = storage.set;
  storage.set = async () => { throw new Error('Storage unavailable'); };
  await assert.rejects(mutation === 'forget' ? w.api.removeTitleCorrection(w.localStore.titleCorrectionsV1[0].key)
    : w.api.saveTitleCorrection({ original, tmdbId: 2 }), /Storage unavailable/);
  storage.set = set;
  finish();
  assert.equal((await pending).tmdbId, 1, 'a failed mutation did not revoke the saved choice');
});

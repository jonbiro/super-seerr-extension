const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker } = require('./helpers/worker');

async function fixture(mediaType = 'movie') {
  const w = loadWorker({ get: async () => ({ seerrUrl: 'https://seerr.example' }) });
  await w.ready;
  const original = { title: 'The Thing', mediaType };
  const choices = [1, 2, 3].map(tmdbId => ({ tmdbId, title: original.title, mediaType }));
  w.api.getMediaCandidates = async () => choices;
  await w.api.saveTitleCorrection({ original, tmdbId: 2 });
  return { w, original, choices, key: w.localStore.titleCorrectionsV1[0].key };
}
function pauseNextValidation(w, choices) {
  let finish, started, first = true;
  const entered = new Promise(resolve => { started = resolve; });
  w.api.getMediaCandidates = () => {
    if (!first) return Promise.resolve(choices);
    first = false; started(); return new Promise(resolve => { finish = () => resolve(choices); });
  };
  return { entered, finish: () => finish() };
}

for (const mediaType of ['movie', 'tv']) for (const mutation of ['forget', 'replace']) {
  test(`older ${mediaType} save cannot undo a confirmed ${mutation}`, async () => {
    const { w, original, choices, key } = await fixture(mediaType);
    const gate = pauseNextValidation(w, choices);
    const pending = w.api.saveTitleCorrection({ original, tmdbId: 1 });
    const rejected = assert.rejects(pending, /match changed/i);
    await gate.entered;
    if (mutation === 'forget') await w.api.removeTitleCorrection(key);
    else await w.api.saveTitleCorrection({ original, tmdbId: 3 });
    gate.finish(); await rejected;
    assert.equal(w.localStore.titleCorrectionsV1.find(row => row.key === key)?.tmdbId ?? null, mutation === 'forget' ? null : 3);
    const restarted = loadWorker({ get: async () => ({ seerrUrl: w.api.baseUrl }), local: w.localStore });
    await restarted.ready;
    restarted.api.getMediaCandidates = async () => choices;
    assert.equal((await restarted.api.getSavedTitleCorrection(original))?.tmdbId ?? null, mutation === 'forget' ? null : 3);
  });
}

for (const mediaType of ['movie', 'tv']) test(`a different ${mediaType} saved match does not cancel a pending save`, async () => {
  const { w, original, choices } = await fixture(mediaType);
  const gate = pauseNextValidation(w, choices);
  const pending = w.api.saveTitleCorrection({ original, tmdbId: 1 });
  await gate.entered;
  await w.api.saveTitleCorrection({ original: { ...original, title: 'Another title' }, tmdbId: 3 });
  gate.finish(); await pending;
  assert.equal((await w.api.getSavedTitleCorrection(original)).tmdbId, 1);
  assert.equal(w.localStore.titleCorrectionsV1.length, 2);
});

for (const mediaType of ['movie', 'tv']) test(`a newer ${mediaType} save can finish after an earlier save`, async () => {
  const { w, original, choices } = await fixture(mediaType);
  const earlier = pauseNextValidation(w, choices);
  const first = w.api.saveTitleCorrection({ original, tmdbId: 1 });
  await earlier.entered;
  const later = pauseNextValidation(w, choices);
  const second = w.api.saveTitleCorrection({ original, tmdbId: 3 });
  await later.entered;
  earlier.finish(); await first;
  later.finish(); await second;
  assert.equal((await w.api.getSavedTitleCorrection(original)).tmdbId, 3);
});

for (const mutation of ['forget', 'replace']) test(`a failed ${mutation} does not cancel an earlier pending save`, async () => {
  const { w, original, choices, key } = await fixture();
  const gate = pauseNextValidation(w, choices);
  const pending = w.api.saveTitleCorrection({ original, tmdbId: 1 });
  await gate.entered;
  const storage = w.context.chrome.storage.local, set = storage.set;
  storage.set = async () => { throw new Error('Storage unavailable'); };
  await assert.rejects(mutation === 'forget' ? w.api.removeTitleCorrection(key)
    : w.api.saveTitleCorrection({ original, tmdbId: 3 }), /Storage unavailable/);
  storage.set = set;
  gate.finish(); await pending;
  assert.equal((await w.api.getSavedTitleCorrection(original)).tmdbId, 1);
});

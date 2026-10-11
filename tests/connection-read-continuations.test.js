const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker } = require('./helpers/worker');
async function fixture() {
  const w = loadWorker({ get: async () => ({ seerrUrl: 'https://home.example', seerrApiKey: 'home-key' }) });
  await w.ready;
  return w.api;
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function change(api, kind) {
  if (kind === 'server') api.baseUrl = 'https://family.example';
  else if (kind === 'key') api.apiKey = 'replacement';
  else api.connections = { revision: 2, activeId: api.baseUrl };
  api.invalidateSeerrReads();
}
for (const kind of ['server', 'key', 'revision']) {
  for (const stage of ['identity', 'search']) test(`status stops after ${stage} when ${kind} changes`, async () => {
    const api = await fixture(), gate = deferred(); let details = 0;
    api.tmdbIdentityMatches = () => gate.promise;
    api.resolveMediaMatch = () => gate.promise;
    api.getMediaDetails = async () => { details++; return { id: 1, mediaInfo: { status: 5 } }; };
    const result = api.getMediaStatusUncached({ title: 'The Thing', mediaType: 'movie', ...(stage === 'identity' ? { tmdbId: 1 } : {}) });
    change(api, kind);
    gate.resolve(stage === 'identity' ? true : { id: 1 });
    assert.equal((await result).status, 'error');
    assert.equal(details, 0, 'old identity cannot start a detail read on the new connection');
  });
  test(`title search stops before another variant when ${kind} changes`, async () => {
    const api = await fixture(), gate = deferred(); let searches = 0;
    api.generateSearchTerms = () => ['The Thing', 'Thing'];
    api.searchMedia = () => { searches++; return searches === 1 ? gate.promise : []; };
    const result = api.getMediaCandidates({ title: 'The Thing', mediaType: 'movie' });
    const rejected = assert.rejects(result, /site changed/);
    change(api, kind); gate.resolve([]);
    await rejected;
    assert.equal(searches, 1);
  });
  test(`request-history completion cannot start a new-site detail read after ${kind} changes`, async () => {
    const api = await fixture(), gate = deferred(); let reads = 0;
    api.searchRequests = () => gate.promise;
    api.makeAPIRequest = async () => { reads++; return { id: 1 }; };
    const result = api.getMediaDetails(1, 'movie');
    const rejected = assert.rejects(result, /site changed/);
    change(api, kind); gate.resolve(null);
    await rejected;
    assert.equal(reads, 0);
  });
}
test('identity verification does not treat a connection change as an ordinary lookup failure', async () => {
  const api = await fixture(), gate = deferred();
  api.makeAPIRequest = () => gate.promise;
  const result = api.tmdbIdentityMatches({ title: 'The Thing', mediaType: 'movie', tmdbId: 1 });
  const rejected = assert.rejects(result, /site changed/);
  change(api, 'server'); gate.reject(new Error('Old server offline'));
  await rejected;
});

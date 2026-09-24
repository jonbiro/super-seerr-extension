const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker } = require('./helpers/worker');
const media = { title: 'Example', mediaType: 'tv', tmdbId: 42 };
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
async function setup() {
  const worker = loadWorker({ get: async () => ({ seerrUrl: 'https://seerr.example' }),
    local: { seerrApiKey: 'old-key', plexToken: 'old-token' } });
  await worker.ready;
  return worker.api;
}

for (const action of ['addToWatchlist', 'getSeasonOptions']) {
  for (const stage of ['identity', 'search']) {
    for (const field of ['baseUrl', 'apiKey']) {
      test(`${action} rejects ${field} changes during ${stage}`, async () => {
        const api = await setup(), gate = deferred();
        let calls = 0;
        api.tmdbIdentityMatches = () => gate.promise;
        api.resolveMediaMatch = () => gate.promise;
        api.makeAPIRequest = api.sendAPIRequest = async () => { calls++; return { id: 1, seasons: [] }; };
        const pending = api[action]({ ...media, tmdbId: stage === 'search' ? undefined : 42 });
        api[field] = field === 'baseUrl' ? 'https://other.example' : 'new-key';
        gate.resolve(stage === 'search' ? { id: 42 } : true);
        await assert.rejects(pending, /Settings changed/);
        assert.equal(calls, 0, 'no follow-up request may use the changed settings');
      });
    }
  }
}

for (const stage of ['resolution', 'state']) {
  for (const token of ['new-token', null]) {
    test(`Plex add stops after token ${token ? 'replacement' : 'removal'} during ${stage}`, async () => {
      const api = await setup(), gate = deferred();
      let puts = 0;
      api.plexResolveRatingKey = () => stage === 'resolution' ? gate.promise : Promise.resolve({ ratingKey: 'rk123' });
      api.plexUserState = () => stage === 'state' ? gate.promise : Promise.resolve(null);
      api.plexFetch = async (_url, options) => { if (options.method === 'PUT') puts++; };
      const pending = api.plexAddToWatchlist(media);
      await new Promise(resolve => setImmediate(resolve));
      api.plexToken = token;
      gate.resolve(stage === 'resolution' ? { ratingKey: 'rk123' } : null);
      await assert.rejects(pending, /Plex account changed/);
      assert.equal(puts, 0);
    });
  }
}

test('Plex state from an old account is returned as unknown', async () => {
  const api = await setup(), gate = deferred();
  api.plexResolveRatingKey = async () => ({ ratingKey: 'rk123' });
  api.plexUserState = () => gate.promise;
  const pending = api.plexWatchlistState(media);
  await new Promise(resolve => setImmediate(resolve));
  api.plexToken = 'new-token';
  gate.resolve({ onWatchlist: true });
  const result = await pending;
  assert.equal(result.unknown, true);
  assert.equal(result.onWatchlist, false);
});

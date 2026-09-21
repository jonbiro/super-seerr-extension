const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker } = require('./helpers/worker');
const Config = require('../src/shared/RatingsConfig');
const sender = { id: 'test', tab: { id: 1 }, frameId: 0, url: 'https://seerr.example/base/discover' };
const server = 'https://seerr.example/base/';
const blob = (extra = {}) => ({ server, epoch: 0, matcher: Config.matcherVersion, entries: {
  'movie:1': { bundle: { rtCriticsScore: 75, confidence: 1, source: 'seerr-native' }, cachedAt: Date.now() }
}, index: [], ...extra });
async function setup(local = {}) {
  const worker = loadWorker({ get: async () => ({ seerrUrl: server }), local: { seerrApiKey: 'secret-key', plexToken: 'secret-token', ...local } });
  await worker.ready; return worker;
}

test('cache messages require the extension, exact configured origin, path and top frame', async () => {
  const { api } = await setup();
  for (const invalid of [
    { ...sender, id: 'other' }, { ...sender, tab: undefined }, { ...sender, frameId: 1 },
    { ...sender, url: 'https://seerr.example:8443/base/discover' },
    { ...sender, url: 'https://seerr.example/baseball/discover' },
    { ...sender, url: 'https://www.imdb.com/title/tt1' },
    { ...sender, url: 'chrome-extension://test/src/options/options.html' }
  ]) {
    await assert.rejects(api.getOverlayCache(invalid));
    await assert.rejects(api.putOverlayCache(blob(), invalid));
  }
  assert.equal((await api.getOverlayCache(sender)).ratingsCacheEpoch, 0);
});

test('cache bridge strips unsupported fields and cannot read or overwrite secrets', async () => {
  const { api, localStore } = await setup();
  const value = blob({ seerrApiKey: 'replace-key', plexToken: 'replace-token' });
  value.entries['movie:1'].bundle.plexToken = 'hidden';
  value.entries['movie:1'].bundle.imdbRating = 99;
  value.index = [{ tmdbId: '1', mediaType: 'movie', title: 'Example', seerrApiKey: 'hidden' }];
  await api.putOverlayCache(value, sender);
  const result = await api.getOverlayCache(sender);
  assert.equal(localStore.seerrApiKey, 'secret-key');
  assert.equal(localStore.plexToken, 'secret-token');
  assert.doesNotMatch(JSON.stringify(result), /secret-key|secret-token|replace-key|hidden|seerrApiKey|plexToken/);
  assert.equal(result.overlayRatingsV1.entries['movie:1'].bundle.imdbRating, null);
  assert.equal(result.overlayRatingsV1.entries['movie:1'].bundle.rtCriticsScore, 75);
});

test('stale epochs and oversized data cannot overwrite cleared or current cache', async () => {
  const { api, localStore } = await setup();
  await api.putOverlayCache(blob(), sender);
  await api.clearRatingsCache();
  assert.equal((await api.putOverlayCache(blob(), sender)).stored, false);
  assert.equal(localStore.overlayRatingsV1, undefined);
  await assert.rejects(api.putOverlayCache(blob({ epoch: localStore.ratingsCacheEpoch, extra: 'x'.repeat(3_000_001) }), sender), /size limit/);
});

test('cache clearing waits for an in-flight write and remains cleared after it completes', async () => {
  const worker = await setup();
  let release, announce;
  const entered = new Promise(resolve => { announce = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const original = worker.context.chrome.storage.local.set;
  worker.context.chrome.storage.local.set = async value => {
    if (value.overlayRatingsV1) { announce(); await gate; }
    await original(value);
  };
  const writing = worker.api.putOverlayCache(blob(), sender);
  await entered;
  const clearing = worker.api.clearRatingsCache();
  release(); await Promise.all([writing, clearing]);
  assert.equal(worker.localStore.overlayRatingsV1, undefined);
  assert.notEqual(worker.localStore.ratingsCacheEpoch, 0);
});

test('local storage uses trusted access when available and preserves unsupported-browser behavior', async () => {
  const worker = await setup();
  assert.equal(await worker.api.restrictLocalStorage(), false);
  let level;
  worker.context.chrome.storage.local.setAccessLevel = async value => { level = value.accessLevel; };
  assert.equal(await worker.api.restrictLocalStorage(), true);
  assert.equal(level, 'TRUSTED_CONTEXTS');
});

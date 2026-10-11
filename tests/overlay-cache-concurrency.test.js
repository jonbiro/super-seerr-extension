const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { loadWorker } = require('./helpers/worker');
const Config = require('../src/shared/RatingsConfig');
const Model = require('../src/shared/RatingsModel');
const server = 'https://seerr.example/';
const sender = { id: 'test', tab: { id: 1 }, frameId: 0, url: server + 'discover' };
const entry = (score, at) => ({ bundle: Model.createRatingsBundle({ rtCriticsScore: score, confidence: 1 }), cachedAt: at });
async function setup(local = {}) {
  const worker = loadWorker({ get: async () => ({ seerrUrl: server }), local });
  await worker.ready;
  return worker;
}
function tab(worker, { index = [], send } = {}) {
  const context = vm.createContext({
    chrome: { runtime: { sendMessage: send || (async message => ({ success: true, data: message.action === 'getOverlayCache'
      ? await worker.api.getOverlayCache(sender) : await worker.api.putOverlayCache(message.data, sender) })) } },
    setTimeout: () => 1, clearTimeout() {}
  });
  vm.runInContext(fs.readFileSync('src/content/OverlayCache.js', 'utf8'), context);
  return context.createOverlayCache({ Config, Model, log() {}, getServer: () => new URL(server),
    getListIndex: () => index, restoreListIndex() {} });
}
const stored = worker => worker.localStore.overlayRatingsByServerV1['https://seerr.example'];

test('two tabs preserve each other\'s new ratings and title indexes', async () => {
  const worker = await setup();
  const a = tab(worker, { index: [{ tmdbId: '1', mediaType: 'movie', title: 'First' }] });
  const b = tab(worker, { index: [{ tmdbId: '2', mediaType: 'movie', title: 'Second' }] });
  await Promise.all([a.loadPersistedRatings(), b.loadPersistedRatings()]);
  a.ratingsCache.set('movie:1', entry(80, 100)); b.ratingsCache.set('movie:2', entry(90, 200));
  await Promise.all([a.flushPersistedRatings(), b.flushPersistedRatings()]);
  assert.equal(stored(worker).entries['movie:1'].bundle.rtCriticsScore, 80);
  assert.equal(stored(worker).entries['movie:2'].bundle.rtCriticsScore, 90);
  assert.deepEqual(Array.from(stored(worker).index, item => item.tmdbId).sort(), ['1', '2']);
});

for (const change of ['refresh', 'forget']) {
  test(`an older tab cannot undo another tab's ${change}`, async () => {
    const worker = await setup();
    const seed = tab(worker); await seed.loadPersistedRatings();
    seed.ratingsCache.set('movie:1', entry(20, 100)); await seed.flushPersistedRatings();
    const a = tab(worker), b = tab(worker);
    await Promise.all([a.loadPersistedRatings(), b.loadPersistedRatings()]);
    if (change === 'refresh') a.ratingsCache.set('movie:1', entry(95, 300));
    else a.ratingsCache.delete('movie:1');
    await a.flushPersistedRatings();
    b.ratingsCache.set('movie:2', entry(70, 200)); await b.flushPersistedRatings();
    if (change === 'refresh') assert.equal(stored(worker).entries['movie:1'].bundle.rtCriticsScore, 95);
    else assert.equal(stored(worker).entries['movie:1'], undefined);
    assert.equal(stored(worker).entries['movie:2'].bundle.rtCriticsScore, 70);
  });
}

test('a failed cache read is retried before persisting under a cleared epoch', async () => {
  const worker = await setup({ ratingsCacheEpoch: 'cleared' });
  let reads = 0;
  const cache = tab(worker, { send: async message => {
    if (message.action === 'getOverlayCache') {
      if (++reads === 1) throw new Error('Worker temporarily unavailable');
      return { success: true, data: await worker.api.getOverlayCache(sender) };
    }
    return { success: true, data: await worker.api.putOverlayCache(message.data, sender) };
  } });
  await cache.loadPersistedRatings();
  cache.ratingsCache.set('movie:1', entry(80, 100)); await cache.flushPersistedRatings();
  assert.equal(reads, 2);
  assert.equal(stored(worker).epoch, 'cleared');
  assert.equal(stored(worker).entries['movie:1'].bundle.rtCriticsScore, 80);
});

test('a rejected stale cache write reloads its epoch and can retry', async () => {
  const worker = await setup();
  const cache = tab(worker); await cache.loadPersistedRatings();
  worker.localStore.ratingsCacheEpoch = 'cleared';
  cache.ratingsCache.set('movie:1', entry(80, 100));
  await cache.flushPersistedRatings();
  assert.equal(worker.localStore.overlayRatingsByServerV1, undefined);
  assert.equal(cache.ratingsCache.size, 0, 'pre-clear ratings cannot be restored by a stale tab');
  await cache.loadPersistedRatings();
  cache.ratingsCache.set('movie:1', entry(95, 200));
  await cache.flushPersistedRatings();
  assert.equal(stored(worker).epoch, 'cleared');
  assert.equal(stored(worker).entries['movie:1'].bundle.rtCriticsScore, 95);
});

test('an older tab cannot overwrite another tab\'s updated title metadata', async () => {
  const worker = await setup();
  const oldTitle = { tmdbId: '1', mediaType: 'movie', title: 'Old title' };
  const seed = tab(worker, { index: [oldTitle] });
  await seed.loadPersistedRatings(); await seed.flushPersistedRatings();
  const firstIndex = [oldTitle], secondIndex = [oldTitle];
  const a = tab(worker, { index: firstIndex }), b = tab(worker, { index: secondIndex });
  await Promise.all([a.loadPersistedRatings(), b.loadPersistedRatings()]);
  firstIndex[0] = { ...oldTitle, title: 'Updated title' }; await a.flushPersistedRatings();
  secondIndex.push({ tmdbId: '2', mediaType: 'movie', title: 'Other title' }); await b.flushPersistedRatings();
  assert.equal(stored(worker).index.find(item => item.tmdbId === '1').title, 'Updated title');
  assert.equal(stored(worker).index.find(item => item.tmdbId === '2').title, 'Other title');
});

test('forgetting an old rating cannot remove a fresher result saved by another tab', async () => {
  const worker = await setup();
  const seed = tab(worker); await seed.loadPersistedRatings();
  seed.ratingsCache.set('movie:1', entry(20, 100)); await seed.flushPersistedRatings();
  const a = tab(worker), b = tab(worker);
  await Promise.all([a.loadPersistedRatings(), b.loadPersistedRatings()]);
  a.ratingsCache.set('movie:1', entry(95, 300)); await a.flushPersistedRatings();
  b.ratingsCache.delete('movie:1'); await b.flushPersistedRatings();
  assert.equal(stored(worker).entries['movie:1'].bundle.rtCriticsScore, 95);
});

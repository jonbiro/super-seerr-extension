const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker } = require('./helpers/worker');
const { loadOverlay } = require('./helpers/overlay');
const Config = require('../src/shared/RatingsConfig');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('one clear operation invalidates worker memory, persisted layers and endpoint availability', async () => {
  const worker = loadWorker({ local: { rtCacheV1: {}, overlayRatingsV1: {}, seerrRatingsUnavailableV1: {} } });
  await worker.ready;
  worker.api.cacheRottenTomatoesResult('movie:Old:', { rtCriticsScore: 1 }, Config.rtCacheTtlMs);
  const reply = await new Promise(resolve => worker.listeners.message({ action: 'clearRatingsCache' }, {}, resolve));
  assert.equal(reply.success, true);
  assert.equal(worker.api.rtCache.size, 0);
  assert.equal(worker.api.rtCacheFlushTimer, null);
  for (const key of ['rtCacheV1', 'overlayRatingsV1', 'seerrRatingsUnavailableV1']) assert.equal(worker.localStore[key], undefined);
  assert.ok(worker.localStore.ratingsCacheEpoch);
});

test('an in-flight RT lookup cannot repopulate a cleared cache', async () => {
  const worker = loadWorker();
  await worker.ready;
  const answer = deferred(), started = deferred();
  worker.api.rtBestMatchFor = async () => { started.resolve(); return answer.promise; };
  const old = worker.api.getRottenTomatoesRatings({ title: 'Old' });
  await started.promise;
  await worker.api.clearRatingsCache();
  answer.resolve(null);
  await old;
  assert.equal(worker.api.rtCache.size, 0);
  assert.equal(worker.api.rtPending.size, 0);
  assert.equal(worker.localStore.rtCacheV1, undefined);
  worker.api.rtBestMatchFor = async () => null;
  await worker.api.getRottenTomatoesRatings({ title: 'Fresh' });
  assert.equal(worker.api.rtCache.has('movie:Fresh:'), true);
});

test('clear waits for a write already in progress before removing storage', async () => {
  const worker = loadWorker();
  await worker.ready;
  const writing = deferred(), release = deferred();
  const set = worker.context.chrome.storage.local.set;
  worker.context.chrome.storage.local.set = async value => {
    if (value.rtCacheV1) { writing.resolve(); await release.promise; }
    return set(value);
  };
  worker.api.cacheRottenTomatoesResult('movie:Old:', {}, Config.rtCacheTtlMs);
  const flush = worker.api.flushRtCache();
  await writing.promise;
  const clear = worker.api.clearRatingsCache();
  release.resolve();
  await Promise.all([clear, flush]);
  assert.equal(worker.localStore.rtCacheV1, undefined);
});

test('a stale persisted-cache read is discarded after clear', async () => {
  const worker = loadWorker();
  await worker.ready;
  const read = deferred();
  worker.context.chrome.storage.local.get = () => read.promise;
  const loading = worker.api.loadRtCache();
  await worker.api.clearRatingsCache();
  read.resolve({ rtCacheV1: { matcher: Config.matcherVersion, entries: {
    'movie:Old:': { expiresAt: Date.now() + 10000, value: { rtCriticsScore: 1 } }
  } } });
  await loading;
  assert.equal(worker.api.rtCache.size, 0);
});

test('overlay ignores writes from an older cache epoch after a reload', async () => {
  const overlay = loadOverlay({ settings: { seerrUrl: 'https://seerr.example/' }, local: {
    ratingsCacheEpoch: 'new',
    overlayRatingsV1: { server: 'https://seerr.example/', matcher: Config.matcherVersion, epoch: 'old', entries: {
      'movie:550': { bundle: { rtCriticsScore: 1 }, cachedAt: Date.now() }
    } }
  } });
  await overlay.loadPersistedRatings();
  assert.equal(overlay.ratingsCache.has('movie:550'), false);
});

test('overlay clear cancels pending flushes and stops old resolvers from caching', async () => {
  const overlay = loadOverlay({ pathname: '/settings', settings: { seerrUrl: 'https://seerr.example/' } });
  await overlay.loadPersistedRatings();
  const result = deferred(), started = deferred();
  overlay.setResolver(async () => { started.resolve(); return result.promise; });
  const old = overlay.getRatings(550, 'Old', 1999, 'movie');
  await started.promise;
  overlay.changeLocal({ ratingsCacheEpoch: { newValue: 'new' } });
  result.resolve(overlay.Model.createRatingsBundle({ rtCriticsScore: 1 }));
  await old;
  assert.equal(overlay.ratingsCache.has('movie:550'), false);
  overlay.runTimers(500);
  assert.equal(overlay.localStore.overlayRatingsV1, undefined);
});

test('a read that starts while a clear is running does not restore it', async () => {
  // The mirror of the test above, and the order that actually happens: the user
  // clicks Clear in Settings while a Seerr tab is resolving a card. The clear
  // has already emptied memory and bumped the generation, so a read starting
  // now captures the new generation and its guard cannot fire — it would read
  // the not-yet-removed blob straight back, and the next flush would write it
  // to storage, leaving the clear with no lasting effect.
  const entries = { 'movie:Old:1999': { value: { rtCriticsScore: 80 }, expiresAt: Date.now() + 60000 } };
  const worker = loadWorker({ local: { rtCacheV1: { matcher: Config.matcherVersion, entries } } });
  await worker.ready;

  const clearing = worker.api.clearRatingsCache();
  const reading = worker.api.loadRtCache();
  await Promise.all([clearing, reading]);

  assert.equal(worker.api.rtCache.size, 0, 'a concurrent read must not undo the clear');
  await worker.api.flushRtCache();
  assert.equal(Object.keys(worker.localStore.rtCacheV1?.entries || {}).length, 0, 'nor put it back on disk');
});

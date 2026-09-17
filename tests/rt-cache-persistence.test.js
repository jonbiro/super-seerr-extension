// MV3 evicts the worker after seconds of idle, so an in-memory Map can never
// honour rtCacheTtlMs. These cover the storage.local tier that actually does.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Config = require('../src/shared/RatingsConfig');
const { loadWorker } = require('./helpers/worker');

const RT_KEY = 'rtCacheV1';
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

function stubRt(api, { critics = 80, audience = 90 } = {}) {
  const state = { fetches: 0 };
  api.fetchRtHtml = async () => { state.fetches++; return ''; };
  api.parseRtSearchResults = () => [{ href: '/m/example', title: 'Example', year: 2020, rtCriticsScore: critics }];
  api.parseRtScorecard = () => ({ rtAudienceScore: audience });
  return state;
}

test('a resolved rating is written through to storage.local', async () => {
  const worker = loadWorker();
  stubRt(worker.api);
  await worker.api.getRottenTomatoesRatings({ title: 'Example', year: 2020 });
  await worker.api.flushRtCache();

  const persisted = worker.localStore[RT_KEY];
  assert.ok(persisted, 'cache should be persisted');
  assert.equal(persisted['movie:Example:2020'].value.rtAudienceScore, 90);
  assert.ok(persisted['movie:Example:2020'].expiresAt > Date.now());
});

test('a restarted worker serves the persisted rating without refetching', async () => {
  const first = loadWorker();
  const firstRt = stubRt(first.api);
  await first.api.getRottenTomatoesRatings({ title: 'Example', year: 2020 });
  await first.api.flushRtCache();
  assert.equal(firstRt.fetches, 2, 'a cold lookup fetches search and detail pages');

  // A fresh worker is exactly what eviction produces: empty memory, same disk.
  const restarted = loadWorker({ local: first.localStore });
  const restartedRt = stubRt(restarted.api);
  const result = await restarted.api.getRottenTomatoesRatings({ title: 'Example', year: 2020 });

  assert.equal(restartedRt.fetches, 0, 'the persisted entry should short-circuit the network');
  assert.equal(result.rtCriticsScore, 80);
  assert.equal(result.rtAudienceScore, 90);
});

test('expired persisted entries are ignored and not reloaded', async () => {
  const stale = { [RT_KEY]: { 'movie:Example:2020': { value: { rtCriticsScore: 11 }, expiresAt: Date.now() - 1000 } } };
  const worker = loadWorker({ local: stale });
  const rt = stubRt(worker.api, { critics: 80 });

  const result = await worker.api.getRottenTomatoesRatings({ title: 'Example', year: 2020 });
  assert.equal(rt.fetches, 2, 'an expired entry must not be served');
  assert.equal(result.rtCriticsScore, 80);
  assert.ok(!worker.api.rtCache.has('movie:Nonexistent:'));
});

test('a corrupt persisted cache degrades to a cold start rather than throwing', async () => {
  for (const stored of ['not an object', 42, null, { 'movie:X:': 'garbage' }, { 'movie:X:': { value: {} } }]) {
    const worker = loadWorker({ local: { [RT_KEY]: stored } });
    const rt = stubRt(worker.api);
    const result = await worker.api.getRottenTomatoesRatings({ title: 'Example', year: 2020 });
    assert.equal(result.rtCriticsScore, 80, `should recover from ${JSON.stringify(stored)}`);
    assert.equal(rt.fetches, 2);
  }
});

test('a live in-memory entry wins over a stale persisted one', async () => {
  const worker = loadWorker({
    local: { [RT_KEY]: { 'movie:Example:2020': { value: { rtCriticsScore: 11 }, expiresAt: Date.now() + 60000 } } }
  });
  worker.api.cacheRottenTomatoesResult('movie:Example:2020', { rtCriticsScore: 99 }, Config.rtCacheTtlMs);
  const rt = stubRt(worker.api);

  const result = await worker.api.getRottenTomatoesRatings({ title: 'Example', year: 2020 });
  assert.equal(result.rtCriticsScore, 99);
  assert.equal(rt.fetches, 0);
});

test('concurrent lookups collapse into a bounded, debounced write', async () => {
  const worker = loadWorker();
  const rt = stubRt(worker.api);
  worker.api.parseRtSearchResults = () => [];
  await Promise.all(Array.from({ length: 12 }, (_, i) => worker.api.getRottenTomatoesRatings({ title: `Title ${i}` })));
  const writesBefore = worker.localWrites.length;
  await settle();
  await worker.api.flushRtCache();

  assert.ok(worker.localWrites.length - writesBefore <= 2, `expected a debounced write, saw ${worker.localWrites.length - writesBefore}`);
  assert.equal(Object.keys(worker.localStore[RT_KEY]).length, 12);
  assert.equal(rt.fetches, 12, 'one search fetch each; no detail fetch without a match');
});

test('the persisted cache never exceeds the configured entry bound', async () => {
  const worker = loadWorker();
  stubRt(worker.api);
  worker.api.parseRtSearchResults = () => [];
  await Promise.all(Array.from({ length: Config.rtCacheMaxEntries + 20 }, (_, i) => worker.api.getRottenTomatoesRatings({ title: `Title ${i}` })));
  await worker.api.flushRtCache();

  assert.equal(worker.api.rtCache.size, Config.rtCacheMaxEntries);
  assert.equal(Object.keys(worker.localStore[RT_KEY]).length, Config.rtCacheMaxEntries);
});

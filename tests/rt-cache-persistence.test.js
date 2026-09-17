// MV3 evicts the worker after seconds of idle, so an in-memory Map can never
// honour rtCacheTtlMs. These cover the storage.local tier that actually does.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Config = require('../src/shared/RatingsConfig');
const { loadWorker } = require('./helpers/worker');

const RT_KEY = 'rtCacheV1';
// The stored shape: entries under the revision of the matching rules that
// scored them. A fixture written flat would simply be discarded, and the test
// would then pass without exercising what it names.
const stored = (entries, matcher = Config.matcherVersion) => ({ [RT_KEY]: { matcher, entries } });
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
  assert.equal(persisted.matcher, Config.matcherVersion, 'stamped with the rules that scored it');
  assert.equal(persisted.entries['movie:Example:2020'].value.rtAudienceScore, 90);
  assert.ok(persisted.entries['movie:Example:2020'].expiresAt > Date.now());
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
  const worker = loadWorker({ local: stored({ 'movie:Example:2020': { value: { rtCriticsScore: 11 }, expiresAt: Date.now() - 1000 } }) });
  const rt = stubRt(worker.api, { critics: 80 });

  const result = await worker.api.getRottenTomatoesRatings({ title: 'Example', year: 2020 });
  assert.equal(rt.fetches, 2, 'an expired entry must not be served');
  assert.equal(result.rtCriticsScore, 80);
  assert.ok(!worker.api.rtCache.has('movie:Nonexistent:'));
});

test('a corrupt persisted cache degrades to a cold start rather than throwing', async () => {
  const corrupt = ['not an object', 42, null, { matcher: Config.matcherVersion, entries: 'garbage' },
    { matcher: Config.matcherVersion, entries: { 'movie:X:': 'garbage' } },
    { matcher: Config.matcherVersion, entries: { 'movie:X:': { value: {} } } }];
  for (const shape of corrupt) {
    const worker = loadWorker({ local: { [RT_KEY]: shape } });
    const rt = stubRt(worker.api);
    const result = await worker.api.getRottenTomatoesRatings({ title: 'Example', year: 2020 });
    assert.equal(result.rtCriticsScore, 80, `should recover from ${JSON.stringify(shape)}`);
    assert.equal(rt.fetches, 2);
  }
});

test('a live in-memory entry wins over a stale persisted one', async () => {
  const worker = loadWorker({
    local: stored({ 'movie:Example:2020': { value: { rtCriticsScore: 11 }, expiresAt: Date.now() + 60000 } })
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
  assert.equal(Object.keys(worker.localStore[RT_KEY].entries).length, 12);
  assert.equal(rt.fetches, 12, 'one search fetch each; no detail fetch without a match');
});

test('the persisted cache never exceeds the configured entry bound', async () => {
  const worker = loadWorker();
  stubRt(worker.api);
  worker.api.parseRtSearchResults = () => [];
  await Promise.all(Array.from({ length: Config.rtCacheMaxEntries + 20 }, (_, i) => worker.api.getRottenTomatoesRatings({ title: `Title ${i}` })));
  await worker.api.flushRtCache();

  assert.equal(worker.api.rtCache.size, Config.rtCacheMaxEntries);
  assert.equal(Object.keys(worker.localStore[RT_KEY].entries).length, Config.rtCacheMaxEntries);
});

test('results scored under superseded matching rules are not served', async () => {
  // The worker holds an RT result, confidence included, for a day. Tightening
  // the match rules would otherwise leave that day's titles displaying the old
  // verdict — the score marked approximate however exact the match now is.
  const worker = loadWorker({
    local: stored({ 'movie:Example:2020': { value: { rtCriticsScore: 11, confidence: 0.97 }, expiresAt: Date.now() + 60000 } },
      Config.matcherVersion - 1)
  });
  const rt = stubRt(worker.api, { critics: 80 });

  const result = await worker.api.getRottenTomatoesRatings({ title: 'Example', year: 2020 });
  assert.equal(rt.fetches, 2, 'a stale verdict is looked up again rather than served');
  assert.equal(result.rtCriticsScore, 80);
});

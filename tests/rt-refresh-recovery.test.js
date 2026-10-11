const { test } = require('node:test');
const assert = require('node:assert/strict');
const Config = require('../src/shared/RatingsConfig');
const { loadWorker } = require('./helpers/worker');
const input = { title: 'Fight Club', mediaType: 'movie', year: 1999 };
const key = 'movie:Fight Club:1999';

function provider(worker, { critics = 80, audience = 90, failedDetail = false } = {}) {
  const calls = [];
  worker.api.fetchRtHtml = async url => {
    calls.push(url);
    if (failedDetail && !url.includes('/search?')) throw new Error('Temporary detail failure');
    return '';
  };
  worker.api.parseRtSearchResults = () => [{ href: '/m/fight_club', title: input.title, year: input.year, rtCriticsScore: critics }];
  worker.api.parseRtScorecard = () => ({ rtAudienceScore: audience });
  return calls;
}

for (const critics of [null, 80]) {
  test(`a failed RT detail lookup (${critics === null ? 'no scores' : 'partial score'}) recovers after the short retry window on another site`, async () => {
    const worker = loadWorker(); await worker.ready;
    let now = Date.now(); worker.context.Date = class extends Date { static now() { return now; } };
    const failedCalls = provider(worker, { critics, failedDetail: true });
    const result = await worker.api.getRottenTomatoesRatings(input);
    assert.equal(result.diagnostic, 'failed');
    assert.equal(result.rtCriticsScore, critics);
    now += Config.inconclusiveRetryMs - 1;
    await worker.api.getRottenTomatoesRatings(input);
    assert.equal(failedCalls.length, 2, 'the short backoff must still prevent repeated transport calls');
    now += 2;
    worker.api.baseUrl = 'https://second-seerr.example';
    const recoveredCalls = provider(worker, { critics: 95 });
    const recovered = await worker.api.getRottenTomatoesRatings(input);
    assert.equal(recovered.rtCriticsScore, 95);
    assert.equal(recovered.rtAudienceScore, 90);
    assert.equal(recovered.diagnostic, 'rated');
    assert.equal(recoveredCalls.length, 2);
    await worker.api.flushRtCache();
  });
}

test('a restart clamps older hour-long failed cache records to the short retry window', async () => {
  const now = Date.now(), checkedAt = now - Config.inconclusiveRetryMs - 1000;
  const worker = loadWorker({ local: { rtCacheV1: { matcher: Config.matcherVersion, entries: { [key]: {
    checkedAt, expiresAt: checkedAt + Config.rtNegativeCacheTtlMs, diagnostic: 'failed',
    value: { rtCriticsScore: 80, rtAudienceScore: null, confidence: 1, source: 'rotten-tomatoes',
      matchedTitle: input.title, matchedYear: input.year, url: '/m/fight_club' }
  } } } } });
  await worker.ready;
  const calls = provider(worker, { critics: 95 });
  assert.equal((await worker.api.getRottenTomatoesRatings(input)).rtCriticsScore, 95);
  assert.equal(calls.length, 2);
  await worker.api.flushRtCache();
});

test('a failed refresh preserves the last unexpired title result without renewing its age', async () => {
  const worker = loadWorker(); await worker.ready; provider(worker);
  const first = await worker.api.getRottenTomatoesRatings(input);
  const original = { ...worker.api.rtCache.get(key) };
  worker.api.fetchRtHtml = async () => { throw new Error('Search unavailable'); };
  await assert.rejects(worker.api.getRottenTomatoesRatings({ ...input, refresh: true }), /Search unavailable/);
  const fallback = await worker.api.getRottenTomatoesRatings(input);
  assert.equal(fallback.rtCriticsScore, 80);
  assert.equal(fallback.lastUpdated, first.lastUpdated);
  assert.equal(worker.api.rtCache.get(key).checkedAt, original.checkedAt);
  assert.equal(worker.api.rtCache.get(key).expiresAt, original.expiresAt);
  await worker.api.flushRtCache();
  const restarted = loadWorker({ local: worker.localStore }); await restarted.ready;
  const calls = provider(restarted, { critics: 10 });
  assert.equal((await restarted.api.getRottenTomatoesRatings(input)).rtCriticsScore, 80);
  assert.equal(calls.length, 0);
});

test('ordinary lookups can use the previous title score while a refresh is pending', async () => {
  const worker = loadWorker(); await worker.ready; provider(worker);
  await worker.api.getRottenTomatoesRatings(input);
  let finish, began, lookups = 0;
  const started = new Promise(resolve => { began = resolve; });
  const gate = new Promise(resolve => { finish = resolve; });
  worker.api.rtBestMatchFor = () => { lookups++; began(); return gate; };
  const refresh = worker.api.getRottenTomatoesRatings({ ...input, refresh: true });
  await started;
  const ordinary = worker.api.getRottenTomatoesRatings(input);
  await new Promise(resolve => setImmediate(resolve));
  finish({ href: '/m/fight_club', title: input.title, year: input.year, confidence: 1, rtCriticsScore: 95 });
  assert.equal((await ordinary).rtCriticsScore, 80);
  assert.equal((await refresh).rtCriticsScore, 95);
  assert.equal(lookups, 1, 'a second tab must not duplicate the active provider lookup');
  assert.equal(worker.api.rtCache.get(key).value.rtCriticsScore, 95);
  await worker.api.flushRtCache();
});

for (const critics of [null, 95]) {
  test(`a failed detail refresh (${critics === null ? 'no scores' : 'partial score'}) retains the successful title fallback`, async () => {
    const worker = loadWorker(); await worker.ready; provider(worker);
    await worker.api.getRottenTomatoesRatings(input);
    const original = worker.api.rtCache.get(key);
    provider(worker, { critics, failedDetail: true });
    const attempt = await worker.api.getRottenTomatoesRatings({ ...input, refresh: true });
    assert.equal(attempt.diagnostic, 'failed', 'the refreshing caller must learn the attempt failed');
    assert.equal(attempt.rtCriticsScore, critics);
    assert.equal(worker.api.rtCache.get(key), original, 'retain the original score, timestamp and expiry');
    const fallback = await worker.api.getRottenTomatoesRatings(input);
    assert.equal(fallback.rtCriticsScore, 80);
    assert.equal(fallback.rtAudienceScore, 90);
    assert.equal(fallback.lastUpdated, original.checkedAt);
    await worker.api.flushRtCache();
    const restarted = loadWorker({ local: worker.localStore }); await restarted.ready;
    const calls = provider(restarted, { critics: 10 });
    assert.equal((await restarted.api.getRottenTomatoesRatings(input)).rtAudienceScore, 90);
    assert.equal(calls.length, 0);
  });
}

test('a completed no-match refresh replaces the previous title score', async () => {
  const worker = loadWorker(); await worker.ready; provider(worker);
  await worker.api.getRottenTomatoesRatings(input);
  worker.api.parseRtSearchResults = () => [];
  assert.equal(await worker.api.getRottenTomatoesRatings({ ...input, refresh: true }), null);
  assert.equal(await worker.api.getRottenTomatoesRatings(input), null);
  assert.equal(worker.api.rtCache.get(key).diagnostic, 'unrated');
  await worker.api.flushRtCache();
});

test('a failed refresh cannot revive an expired title score', async () => {
  const worker = loadWorker(); await worker.ready; provider(worker);
  let now = Date.now(); worker.context.Date = class extends Date { static now() { return now; } };
  await worker.api.getRottenTomatoesRatings(input);
  now = worker.api.rtCache.get(key).expiresAt + 1;
  worker.api.fetchRtHtml = async () => { throw new Error('Search unavailable'); };
  await assert.rejects(worker.api.getRottenTomatoesRatings({ ...input, refresh: true }), /Search unavailable/);
  assert.equal(worker.api.rtCache.has(key), false);
  await assert.rejects(worker.api.getRottenTomatoesRatings(input), /Search unavailable/);
  await worker.api.flushRtCache();
});

for (const prior of ['rated', 'unrated', 'failed']) test(`a restart preserves lookup ordering from a ${prior} title-only cache`, async () => {
  const now = Date.now();
  const first = loadWorker(); await first.ready;
  first.context.Date = class extends Date { static now() { return now; } };
  provider(first, { failedDetail: prior === 'failed' });
  if (prior === 'unrated') first.api.parseRtSearchResults = () => [];
  // Multiple lookups within one clock tick are ordered by the worker itself.
  for (let i = 0; i < 3; i++) await first.api.getRottenTomatoesRatings({ ...input, refresh: true });
  await first.api.flushRtCache();
  const saved = first.localStore.rtCacheV1.entries[key];
  assert.ok(saved.checkedAt > now);
  assert.equal(saved.diagnostic, prior);
  assert.equal(Object.keys(first.localStore.publicRatingsV1.entries).length, 0);

  const restarted = loadWorker({ local: first.localStore }); await restarted.ready;
  restarted.context.Date = class extends Date { static now() { return now; } };
  provider(restarted, { critics: 95 });
  assert.equal((await restarted.api.getRottenTomatoesRatings({ ...input, tmdbId: 550, refresh: true })).rtCriticsScore, 95);
  await restarted.api.flushRtCache();
  assert.equal(restarted.localStore.rtCacheV1.entries[key].value.rtCriticsScore, 95, 'the refreshed result must replace the earlier title record');
  assert.ok(restarted.localStore.rtCacheV1.entries[key].checkedAt > saved.checkedAt);
  const calls = provider(restarted, { critics: 10 });
  restarted.api.baseUrl = 'https://second-seerr.example';
  assert.equal((await restarted.api.getRottenTomatoesRatings({ ...input, tmdbId: 550, title: 'El club de la lucha' })).rtCriticsScore, 95);
  assert.equal(calls.length, 0, 'the completed refresh must also reach the shared ID cache');
});

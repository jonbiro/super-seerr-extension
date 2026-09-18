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

test('a run of refusals pauses Rotten Tomatoes lookups instead of hammering it', async () => {
  // Rotten Tomatoes sits behind bot protection and answered a real session with
  // HTTP 403. A grid of fifty cards would keep asking through the whole block.
  const worker = loadWorker();
  let fetches = 0;
  worker.api.fetchRtHtml = async () => { fetches++; throw new Error('Rotten Tomatoes returned HTTP 403'); };

  for (let i = 0; i < Config.rtFailureLimit + 10; i++) {
    await worker.api.getRottenTomatoesRatings({ title: `Title ${i}` }).catch(() => null);
  }

  assert.equal(fetches, Config.rtFailureLimit, 'it stops asking once the run is established');
  assert.ok(worker.api.rtBackoffUntil > Date.now(), 'and holds off for a while');
});

test('a paused lookup is reported as a failure, never as an unrated title', async () => {
  // The distinction matters: a null answer is cached as "nothing knows this
  // title", which would hide a real score for as long as that entry lives.
  const worker = loadWorker();
  worker.api.fetchRtHtml = async () => { throw new Error('Rotten Tomatoes returned HTTP 403'); };
  for (let i = 0; i < Config.rtFailureLimit; i++) {
    await worker.api.getRottenTomatoesRatings({ title: `Title ${i}` }).catch(() => null);
  }

  await assert.rejects(() => worker.api.getRottenTomatoesRatings({ title: 'Fight Club', year: 1999 }),
    /not asking again yet/);
  assert.equal(worker.api.rtCache.has('movie:Fight Club:1999'), false, 'nothing may be cached as unrated');
});

test('one success clears the pause', async () => {
  const worker = loadWorker();
  let refuse = true;
  worker.api.fetchRtHtml = async () => { if (refuse) throw new Error('HTTP 403'); return ''; };
  worker.api.parseRtSearchResults = () => [];
  for (let i = 0; i < Config.rtFailureLimit - 1; i++) {
    await worker.api.getRottenTomatoesRatings({ title: `Title ${i}` }).catch(() => null);
  }
  refuse = false;
  await worker.api.getRottenTomatoesRatings({ title: 'Recovered' });

  assert.equal(worker.api.rtTransportFailures, 0, 'a working service is not held against');
  assert.equal(worker.api.rtBackoffUntil, 0);
});

test('a single refusal is an error, not an answer of "no ratings"', async () => {
  // Below the pause threshold the lookup must still fail loudly. Resolving to
  // null instead would reach the overlay as a conclusive "nothing knows this
  // title", and be remembered as unrated while the service was merely refusing.
  const worker = loadWorker();
  worker.api.fetchRtHtml = async () => { throw new Error('Rotten Tomatoes returned HTTP 403'); };

  await assert.rejects(() => worker.api.getRottenTomatoesRatings({ title: 'Fight Club', year: 1999 }), /403/);
  assert.equal(worker.api.rtCache.has('movie:Fight Club:1999'), false, 'and nothing is cached');
});

// Bounded so a limiter that never releases its waiters fails the suite rather
// than hanging it — which is exactly how that mutation behaved.
test('Rotten Tomatoes page fetches queue instead of arriving all at once', { timeout: 15000 }, async () => {
  // A grid resolves fifty cards at once, and each is one or two page fetches.
  // Arriving together is the shape bot protection notices, and a real session
  // was answered with 403.
  const worker = loadWorker();
  let inFlight = 0, peak = 0;
  worker.context.fetch = async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    // Every lookup allowed to start has started before any finishes, so the
    // peak is real. Nothing here needs releasing by hand: a limiter that never
    // frees its waiters times this test out instead of stalling the runner.
    await new Promise(resolve => setTimeout(resolve, 5));
    inFlight--;
    return { ok: true, text: async () => '' };
  };

  await Promise.all(Array.from({ length: 12 }, (_, i) => worker.api.fetchRtHtml(`/m/title${i}`)));

  assert.equal(peak, Config.rtMaxConcurrent,
    `expected at most ${Config.rtMaxConcurrent} page fetches at once, saw ${peak}`);
});

test('a refusal names the page that was refused', async () => {
  // "Rotten Tomatoes returned HTTP 403" alone cannot tell the search page apart
  // from a title's own page, and they are protected differently.
  const worker = loadWorker();
  worker.context.fetch = async () => ({ ok: false, status: 403 });

  await assert.rejects(() => worker.api.fetchRtHtml('/search?search=Moana'), /403 for \/search\?search=Moana/);
  await assert.rejects(() => worker.api.fetchRtHtml('/m/moana_2'), /403 for \/m\/moana_2/);
});

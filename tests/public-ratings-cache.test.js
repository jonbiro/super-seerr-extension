const { test } = require('node:test');
const assert = require('node:assert/strict');
const Config = require('../src/shared/RatingsConfig');
const { loadWorker } = require('./helpers/worker');
const { loadOverlay } = require('./helpers/overlay');
const input = { tmdbId: 550, mediaType: 'movie', title: 'Fight Club', year: 1999 };
const tick = () => new Promise(resolve => setImmediate(resolve));
function provider(worker, { critics = 80, audience = 90, title = 'Fight Club', year = 1999, href = '/m/fight_club', failDetail = false } = {}) {
  const calls = [];
  worker.api.fetchRtHtml = async url => { calls.push(url); if (failDetail && !url.includes('/search?')) throw new Error('Offline'); return ''; };
  worker.api.parseRtSearchResults = () => [{ title, year, href, rtCriticsScore: critics }];
  worker.api.parseRtScorecard = () => ({ rtAudienceScore: audience });
  return calls;
}
async function seed() {
  const worker = loadWorker(); await worker.ready; provider(worker);
  await worker.api.getRottenTomatoesRatings(input); await worker.api.flushRtCache();
  return worker;
}

test('verified public scores survive restart and reuse an ID across servers and localized titles', async () => {
  const first = await seed();
  assert.equal(first.localStore.publicRatingsV1.entries['movie:550'].source, 'rotten-tomatoes');
  const second = loadWorker({ local: first.localStore }); await second.ready;
  const calls = provider(second, { critics: 12 }); second.api.baseUrl = 'https://other-seerr.example';
  const rating = await second.api.getRottenTomatoesRatings({ ...input, title: 'El club de la lucha' });
  assert.equal(rating.rtCriticsScore, 80); assert.equal(calls.length, 0);
  assert.equal(rating.lastUpdated, first.localStore.publicRatingsV1.entries['movie:550'].checkedAt);
  assert.deepEqual(Object.keys(first.localStore.publicRatingsV1.entries['movie:550'].value).sort(),
    ['confidence', 'matchedTitle', 'matchedYear', 'rtAudienceScore', 'rtCriticsScore', 'source', 'url'].sort());
});

test('movies, TV series, different IDs and contradictory years cannot collide', async () => {
  for (const override of [{ mediaType: 'tv' }, { tmdbId: 551 }, { year: 2000 }]) {
    const saved = await seed(); const worker = loadWorker({ local: saved.localStore }); await worker.ready;
    const calls = provider(worker, { critics: 12 });
    const result = await worker.api.getRottenTomatoesRatings({ ...input, title: 'Localized', ...override });
    assert.ok(calls.length > 0); assert.notEqual(result?.rtCriticsScore, 80);
  }
});

for (const [name, request, options] of [
  ['missing ID', { tmdbId: null }, {}], ['missing type', { mediaType: undefined }, {}],
  ['null type', { mediaType: null }, {}], ['invalid ID', { tmdbId: '1e3' }, {}],
  ['unsafe ID', { tmdbId: Number.MAX_SAFE_INTEGER + 1 }, {}], ['missing year', { year: null }, {}],
  ['approximate match', {}, { year: 1998 }], ['failed detail lookup', {}, { failDetail: true }],
  ['wrong provider', {}, { href: 'https://other.example/m/fight_club' }],
  ['TV season instead of series', { mediaType: 'tv' }, { href: '/tv/fight_club/s01' }],
  ['no scores', {}, { critics: null, audience: null }]
]) test(`${name} is never promoted to the public ID cache`, async () => {
  const worker = loadWorker(); await worker.ready; provider(worker, options);
  await worker.api.getRottenTomatoesRatings({ ...input, ...request }); await worker.api.flushRtCache();
  assert.equal(worker.api.publicRatings.size, 0);
  assert.deepEqual(Object.keys(worker.localStore.publicRatingsV1.entries), []);
});

test('real zero-percent ratings are shared', async () => {
  const worker = loadWorker(); await worker.ready; provider(worker, { critics: 0, audience: 0 });
  await worker.api.getRottenTomatoesRatings(input);
  assert.equal(worker.api.publicRatings.get('movie:550').value.rtCriticsScore, 0);
});

test('public refresh updates other sites and a failed refresh preserves the verified fallback', async () => {
  const worker = await seed(); provider(worker, { critics: 95 });
  await worker.api.getRottenTomatoesRatings({ ...input, refresh: true });
  provider(worker, { failDetail: true });
  await worker.api.getRottenTomatoesRatings({ ...input, refresh: true });
  const calls = provider(worker, { critics: 20 });
  const result = await worker.api.getRottenTomatoesRatings({ ...input, title: 'Localized' });
  assert.equal(result.rtCriticsScore, 95); assert.equal(result.diagnostic, 'rated'); assert.equal(calls.length, 0);
});

test('a slow older lookup cannot overwrite a newer public refresh or title result', async () => {
  const worker = loadWorker(); await worker.ready;
  let finishOld, started;
  const oldStarted = new Promise(resolve => { started = resolve; });
  worker.api.rtBestMatchFor = async () => { started(); return new Promise(resolve => { finishOld = resolve; }); };
  worker.api.fetchRtHtml = async () => ''; worker.api.parseRtScorecard = () => ({ rtAudienceScore: 90 });
  const old = worker.api.getRottenTomatoesRatings(input); await oldStarted;
  worker.api.rtBestMatchFor = async () => ({ title: 'Fight Club', year: 1999, href: '/m/fight_club', confidence: 1, rtCriticsScore: 99 });
  await worker.api.getRottenTomatoesRatings({ ...input, refresh: true });
  finishOld({ title: 'Fight Club', year: 1999, href: '/m/fight_club', confidence: 1, rtCriticsScore: 10 }); await old;
  assert.equal(worker.api.publicRatings.get('movie:550').value.rtCriticsScore, 99);
  assert.equal(worker.api.rtCache.get('movie:Fight Club:1999').value.rtCriticsScore, 99);
});

test('original-title rescue bypasses an earlier negative title-only lookup', async () => {
  const worker = loadWorker(); await worker.ready; provider(worker);
  assert.equal(await worker.api.getRottenTomatoesRatings({ ...input, title: 'Localized' }), null);
  const rescued = await worker.api.getRottenTomatoesRatings({ ...input, title: 'Localized', originalTitle: 'Fight Club' });
  assert.equal(rescued.rtCriticsScore, 80); assert.equal(worker.api.publicRatings.size, 1);
});

test('clear removes both public and per-server caches and blocks late publication', async () => {
  const worker = await seed(); let finish, started;
  const began = new Promise(resolve => { started = resolve; });
  worker.api.rtBestMatchFor = async () => { started(); return new Promise(resolve => { finish = resolve; }); };
  const pending = worker.api.getRottenTomatoesRatings({ ...input, refresh: true }); await began;
  await worker.api.clearRatingsCache();
  finish({ title: 'Fight Club', year: 1999, href: '/m/fight_club', confidence: 1, rtCriticsScore: 99 }); await pending;
  assert.equal(worker.api.publicRatings.size, 0); assert.equal(worker.api.rtCache.size, 0);
  assert.equal(worker.localStore.publicRatingsV1, undefined); assert.equal(worker.localStore.overlayRatingsByServerV1, undefined);
});

test('expired, old-matcher, malformed and server-specific records cannot become shared public scores', async () => {
  const worker = await seed(), entry = worker.localStore.publicRatingsV1.entries['movie:550'];
  for (const mutation of [
    record => { record.expiresAt = Date.now() - 1; },
    record => { record.source = 'seerr-native'; },
    record => { record.value.confidence = 0.9; },
    record => { record.value.url = 'https://untrusted.example/m/fight_club'; },
    record => { record.checkedAt = 'invalid'; },
    record => { record.value.url = 'https://www.rottentomatoes.com/tv/fight_club'; }
  ]) {
    const record = structuredClone(entry); mutation(record);
    const restarted = loadWorker({ local: { publicRatingsV1: { matcher: Config.matcherVersion, entries: { 'movie:550': record } } } });
    await restarted.ready; await restarted.api.loadRtCache(); assert.equal(restarted.api.publicRatings.size, 0);
  }
  const restarted = loadWorker({ local: { publicRatingsV1: { matcher: Config.matcherVersion - 1, entries: { 'movie:550': entry } } } });
  await restarted.ready; await restarted.api.loadRtCache(); assert.equal(restarted.api.publicRatings.size, 0);
});

test('public storage is byte-bounded and keeps recent scores', async () => {
  const worker = await seed(), entry = worker.api.publicRatings.get('movie:550');
  for (let i = 1; i <= 5000; i++) worker.api.publicRatings.set(`movie:${i}`, { ...entry, checkedAt: entry.checkedAt - i, expiresAt: entry.expiresAt - i });
  const payload = worker.api.publicRatingsPayload();
  assert.ok(Buffer.byteLength(JSON.stringify(payload)) < 1_001_000);
  assert.ok(payload.entries['movie:1']); assert.equal(payload.entries['movie:5000'], undefined);
});

test('content reuses public RT while retaining its own Seerr IMDb/TMDB scores and catalogue', async () => {
  const worker = await seed();
  const overlay = loadOverlay({ pathname: '/discover', settings: { seerrUrl: 'https://seerr.example/' },
    local: worker.localStore,
    scripts: [{ props: { results: [{ id: 550, mediaType: 'movie', title: 'Fight Club', imdbRating: 7.2, voteAverage: 6.1 }] } }],
    sendMessage: async message => { throw new Error(`Unexpected public fetch: ${message.action}`); }
  });
  const bundle = await overlay.getRatings(550, 'Fight Club', 1999, 'movie');
  assert.equal(bundle.rtCriticsScore, 80); assert.equal(bundle.rtAudienceScore, 90);
  assert.equal(bundle.imdbRating, 7.2); assert.equal(bundle.tmdbRating, 6.1);
  await overlay.flushPersistedRatings();
  assert.equal(overlay.localStore.overlayRatingsByServerV1['https://seerr.example'].entries['movie:550'].publicCheckedAt,
    worker.api.publicRatings.get('movie:550').checkedAt);
});

test('loading a newer shared result updates cached RT without overwriting local IMDb/TMDB or their age', async () => {
  const worker = await seed(), checkedAt = worker.api.publicRatings.get('movie:550').checkedAt;
  const local = { ...worker.localStore, overlayRatingsByServerV1: { 'https://seerr.example': {
    server: 'https://seerr.example/', epoch: 0, matcher: Config.matcherVersion, index: [],
    entries: { 'movie:550': { bundle: { rtCriticsScore: 10, rtAudienceScore: 20, imdbRating: 7.2, tmdbRating: 6.1, confidence: 1, source: 'seerr-native' },
      cachedAt: checkedAt - 1000, retryAt: Date.now() + 100000 } }
  } } };
  const overlay = loadOverlay({ pathname: '/discover', settings: { seerrUrl: 'https://seerr.example/' }, local });
  const bundle = await overlay.getRatings(550, 'Fight Club', 1999, 'movie');
  assert.equal(bundle.rtCriticsScore, 80); assert.equal(bundle.imdbRating, 7.2); assert.equal(bundle.tmdbRating, 6.1);
  assert.equal(overlay.ratingsCache.get('movie:550').cachedAt, checkedAt - 1000);
  await tick();
});


test('a temporary public cache read failure is retried instead of pinning a cold cache', async () => {
  const saved = await seed(), worker = loadWorker({ local: saved.localStore }); await worker.ready;
  const read = worker.context.chrome.storage.local.get; let failed = false;
  worker.context.chrome.storage.local.get = async keys => {
    if (!failed && keys.includes('publicRatingsV1')) { failed = true; throw new Error('Temporarily unavailable'); }
    return read(keys);
  };
  await worker.api.loadRtCache(); assert.equal(worker.api.publicRatings.size, 0);
  await worker.api.loadRtCache(); assert.equal(worker.api.publicRatings.size, 1);
});

test('inactive pages cannot publish ID-bound ratings through the worker bridge', async () => {
  const worker = loadWorker({ get: async () => ({ seerrUrl: 'https://seerr.example/' }) }); await worker.ready;
  const calls = provider(worker);
  const reply = await new Promise(resolve => worker.api.handleMessage({ action: 'getRottenTomatoesRatings', data: input },
    { id: 'test', tab: { id: 1 }, frameId: 0, url: 'https://other.example/discover' }, resolve));
  assert.equal(reply.success, false); assert.equal(calls.length, 0); assert.equal(worker.api.publicRatings.size, 0);
});


test('reusing public scores never renews their expiry or delays the overlay refresh', async () => {
  const worker = await seed();
  const entry = worker.localStore.publicRatingsV1.entries['movie:550'];
  entry.checkedAt = Date.now() - 23 * 3600000; entry.expiresAt = entry.checkedAt + Config.rtCacheTtlMs;
  const overlay = loadOverlay({ pathname: '/discover', settings: { seerrUrl: 'https://seerr.example/' }, local: worker.localStore,
    scripts: [{ props: { results: [{ id: 550, mediaType: 'movie', title: 'Fight Club', imdbRating: 7.2, voteAverage: 6.1 }] } }] });
  await overlay.getRatings(550, 'Fight Club', 1999, 'movie');
  const cached = overlay.ratingsCache.get('movie:550');
  assert.equal(cached.publicCheckedAt, entry.checkedAt); assert.equal(cached.retryAt, entry.expiresAt);
  overlay.setResolver(async (_id, _title, _year, _type, options) => { options.outcome.conclusive = false; return null; });
  await overlay.getRatings(550, 'Fight Club', 1999, 'movie', { refresh: true });
  assert.equal(overlay.ratingsCache.get('movie:550').publicCheckedAt, entry.checkedAt);
});


test('identical titles in the same year remain uncertain instead of sharing whichever result ranks first', async () => {
  const worker = loadWorker(); await worker.ready; provider(worker);
  worker.api.parseRtSearchResults = () => [
    { title: 'Fight Club', year: 1999, href: '/m/fight_club', rtCriticsScore: 80 },
    { title: 'Fight Club', year: 1999, href: '/m/other_fight_club', rtCriticsScore: 12 }
  ];
  assert.equal(await worker.api.getRottenTomatoesRatings(input), null);
  assert.equal(worker.api.publicRatings.size, 0);
  assert.equal(worker.api.rtCache.get('movie:Fight Club:1999').diagnostic, 'uncertain');
});


test('duplicate rows for the same provider URL do not create a false ambiguity', async () => {
  const worker = loadWorker(); await worker.ready; provider(worker);
  worker.api.parseRtSearchResults = () => Array.from({ length: 2 }, () =>
    ({ title: 'Fight Club', year: 1999, href: '/m/fight_club', rtCriticsScore: 80 }));
  assert.equal((await worker.api.getRottenTomatoesRatings(input)).rtCriticsScore, 80);
  assert.equal(worker.api.publicRatings.size, 1);
});


test('the RT title tier is also byte-bounded so combined site and public caches leave quota headroom', async () => {
  const worker = await seed(), now = Date.now(); worker.api.rtCache.clear();
  for (let i = 0; i < 1000; i++) worker.api.rtCache.set(`movie:Title${i}:1999`, {
    value: { source: 'rotten-tomatoes', matchedTitle: 'Long title '.repeat(200), rtCriticsScore: 80 },
    checkedAt: now - i, expiresAt: now + Config.rtCacheTtlMs - i, diagnostic: 'rated'
  });
  await worker.api.flushRtCache();
  const payload = worker.localStore.rtCacheV1;
  assert.ok(Buffer.byteLength(JSON.stringify(payload)) < 1_001_000);
  assert.ok(payload.entries['movie:Title0:1999']); assert.equal(payload.entries['movie:Title999:1999'], undefined);
});

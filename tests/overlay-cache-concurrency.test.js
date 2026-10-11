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

for (const publicFirst of [false, true]) test(`concurrent public and server updates retain both sources (${publicFirst ? 'public' : 'server'} first)`, async () => {
  const worker = await setup();
  const seed = tab(worker); await seed.loadPersistedRatings();
  const original = { ...entry(20, 100), publicCheckedAt: 50 };
  original.bundle.imdbRating = 7;
  seed.ratingsCache.set('movie:1', original); await seed.flushPersistedRatings();
  const a = tab(worker), b = tab(worker);
  await Promise.all([a.loadPersistedRatings(), b.loadPersistedRatings()]);
  a.ratingsCache.set('movie:1', { ...original, bundle: { ...original.bundle, rtCriticsScore: 95 }, publicCheckedAt: 400 });
  b.ratingsCache.set('movie:1', { ...original, bundle: { ...original.bundle, imdbRating: 9 }, cachedAt: 300 });
  for (const cache of publicFirst ? [a, b] : [b, a]) await cache.flushPersistedRatings();
  const result = stored(worker).entries['movie:1'];
  assert.equal(result.bundle.rtCriticsScore, 95);
  assert.equal(result.bundle.imdbRating, 9);
  assert.equal(result.cachedAt, 300);
  assert.equal(result.publicCheckedAt, 400);
  const reloaded = tab(worker); await reloaded.loadPersistedRatings();
  assert.equal(reloaded.ratingsCache.get('movie:1').bundle.rtCriticsScore, 95);
});

test('forgetting an old snapshot cannot remove a newer public reconciliation with the same server age', async () => {
  const worker = await setup();
  const seed = tab(worker); await seed.loadPersistedRatings();
  seed.ratingsCache.set('movie:1', { ...entry(20, 100), publicCheckedAt: 50 }); await seed.flushPersistedRatings();
  const a = tab(worker), b = tab(worker);
  await Promise.all([a.loadPersistedRatings(), b.loadPersistedRatings()]);
  a.ratingsCache.set('movie:1', { ...entry(95, 100), publicCheckedAt: 400 }); await a.flushPersistedRatings();
  b.ratingsCache.delete('movie:1'); await b.flushPersistedRatings();
  assert.equal(stored(worker).entries['movie:1']?.bundle.rtCriticsScore, 95);
  const current = tab(worker); await current.loadPersistedRatings();
  current.ratingsCache.delete('movie:1'); await current.flushPersistedRatings();
  assert.equal(stored(worker).entries['movie:1'], undefined, 'a current snapshot can still forget its rating');
});

for (const field of ['rtCriticsScore', 'rtAudienceScore']) test(`concurrent merging gates only RT fields actually retained (${field})`, async () => {
  const worker = await setup();
  const a = tab(worker), b = tab(worker);
  await Promise.all([a.loadPersistedRatings(), b.loadPersistedRatings()]);
  const serverEntry = entry(20, 300); serverEntry.bundle.confidence = 0.2; serverEntry.bundle.imdbRating = 9;
  a.ratingsCache.set('movie:1', serverEntry); await a.flushPersistedRatings();
  b.ratingsCache.set('movie:1', { bundle: Model.createRatingsBundle({ [field]: 95, confidence: 1 }), cachedAt: 100, publicCheckedAt: 400 });
  await b.flushPersistedRatings();
  const result = stored(worker).entries['movie:1'].bundle;
  assert.equal(result[field], 95);
  assert.equal(result.imdbRating, 9);
  assert.equal(result.confidence, field === 'rtCriticsScore' ? 1 : 0.2);
});

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

const publicRecord = (score, checkedAt) => ({ source: 'rotten-tomatoes', checkedAt, expiresAt: checkedAt + Config.rtCacheTtlMs,
  value: { rtCriticsScore: score, rtAudienceScore: 90, confidence: 1, source: 'rotten-tomatoes',
    matchedYear: 1999, matchedTitle: 'Fight Club', url: 'https://www.rottentomatoes.com/m/fight_club' } });

test('public tier refresh preserves native ratings and accepts only newer public records', async () => {
  const worker = await setup(), cache = tab(worker);
  await cache.loadPersistedRatings();
  cache.ratingsCache.set('movie:550', { ...entry(20, 100), bundle: { ...entry(20, 100).bundle, imdbRating: 7 } });
  const now = Date.now();
  worker.api.publicRatings.set('movie:550', publicRecord(95, now));
  assert.deepEqual(Array.from(await cache.refreshPublicRatings()), ['movie:550']);
  assert.equal(cache.getPublicRating('movie:550', 1999).bundle.rtCriticsScore, 95);
  assert.equal(cache.ratingsCache.get('movie:550').bundle.imdbRating, 7);
  assert.equal(cache.ratingsCache.get('movie:550').cachedAt, 100);
  worker.api.publicRatings.set('movie:550', publicRecord(12, now - 1000));
  assert.equal((await cache.refreshPublicRatings()).length, 0);
  assert.equal(cache.getPublicRating('movie:550', 1999).bundle.rtCriticsScore, 95);
});

test('a public tier reply cannot survive a cache clear while its read is pending', async () => {
  const worker = await setup();
  let release;
  let delayed = false;
  const cache = tab(worker, { send: async message => {
    if (delayed) return new Promise(resolve => { release = resolve; });
    return { success: true, data: await worker.api.getOverlayCache(sender) };
  } });
  await cache.loadPersistedRatings();
  delayed = true;
  const pending = cache.refreshPublicRatings();
  await new Promise(resolve => setImmediate(resolve));
  cache.forgetPersistedRatings();
  const now = Date.now();
  release({ success: true, data: { publicRatingsV1: { matcher: Config.matcherVersion, entries: { 'movie:550': publicRecord(99, now) } } } });
  assert.equal((await pending).length, 0);
  assert.equal(cache.getPublicRating('movie:550'), null);
});

for (const publicFirst of [false, true]) {
  for (const expired of [false, true]) test(`merged public ratings preserve expiry and failed-read backoff (public first: ${publicFirst}, expired: ${expired})`, async () => {
    const worker = await setup();
    const a = tab(worker), b = tab(worker);
    await Promise.all([a.loadPersistedRatings(), b.loadPersistedRatings()]);
    const now = Date.now();
    const publicCheckedAt = now - Config.rtCacheTtlMs + (expired ? -1000 : 60000);
    const nativeRetryAt = now + Config.inconclusiveRetryMs;
    a.ratingsCache.set('movie:1', { ...entry(20, now), publicCheckedAt: publicCheckedAt - 1000,
      retryAt: nativeRetryAt, diagnostics: { status: 'failed', checkedAt: now } });
    b.ratingsCache.set('movie:1', { ...entry(95, now - 1000), publicCheckedAt });
    for (const cache of publicFirst ? [b, a] : [a, b]) await cache.flushPersistedRatings();
    const result = stored(worker).entries['movie:1'];
    assert.equal(result.bundle.rtCriticsScore, 95);
    assert.equal(result.cachedAt, now);
    assert.equal(result.retryAt, expired ? nativeRetryAt : publicCheckedAt + Config.rtCacheTtlMs);
    assert.equal(result.diagnostics.status, 'failed');
  });
}


test('a public refresh detects a missed cache clear before merging a new snapshot', async () => {
  const worker = await setup(), cache = tab(worker);
  await cache.loadPersistedRatings();
  cache.ratingsCache.set('movie:550', entry(20, Date.now()));
  worker.api.publicRatings.set('movie:550', publicRecord(80, Date.now()));
  await cache.refreshPublicRatings();
  await worker.api.clearRatingsCache();
  worker.api.publicRatings.set('movie:551', publicRecord(95, Date.now()));
  assert.equal((await cache.refreshPublicRatings()).length, 0);
  assert.equal(cache.ratingsCache.size, 0, 'pre-clear server ratings must be forgotten');
  assert.equal(cache.getPublicRating('movie:550'), null, 'pre-clear public scores must be forgotten');
  await cache.loadPersistedRatings();
  assert.equal(cache.getPublicRating('movie:551').bundle.rtCriticsScore, 95);
  await cache.flushPersistedRatings();
});

for (const change of ['same-time score', 'retry backoff']) {
  test(`forgetting a snapshot preserves another tab's ${change} update`, async () => {
    const worker = await setup();
    const seed = tab(worker); await seed.loadPersistedRatings();
    seed.ratingsCache.set('movie:1', entry(20, 100)); await seed.flushPersistedRatings();
    const a = tab(worker), b = tab(worker);
    await Promise.all([a.loadPersistedRatings(), b.loadPersistedRatings()]);
    const updated = change === 'same-time score' ? entry(95, 100)
      : { ...a.ratingsCache.get('movie:1'), retryAt: Date.now() + Config.inconclusiveRetryMs,
        diagnostics: { status: 'failed', checkedAt: Date.now(), source: 'rotten-tomatoes' } };
    a.ratingsCache.set('movie:1', updated); await a.flushPersistedRatings();
    b.ratingsCache.delete('movie:1'); await b.flushPersistedRatings();
    const result = stored(worker).entries['movie:1'];
    assert.ok(result, 'a changed entry must survive deletion of an older snapshot');
    if (change === 'same-time score') assert.equal(result.bundle.rtCriticsScore, 95);
    else { assert.equal(result.retryAt, updated.retryAt); assert.equal(result.diagnostics.status, 'failed'); }
    const current = tab(worker); await current.loadPersistedRatings();
    current.ratingsCache.delete('movie:1'); await current.flushPersistedRatings();
    assert.equal(stored(worker).entries['movie:1'], undefined, 'the matching current snapshot remains removable');
  });
}

for (const field of ['imdbRating', 'tmdbRating']) for (const publicFirst of [false, true]) {
  test(`same-time public reconciliation preserves another tab's ${field} update (public first: ${publicFirst})`, async () => {
    const worker = await setup();
    const now = Date.now();
    const original = { ...entry(20, now - 1000), publicCheckedAt: now - 2000, retryAt: now + 10000,
      diagnostics: { status: 'partial', checkedAt: now - 1000, source: 'seerr-native' } };
    original.bundle.imdbRating = 8; original.bundle.tmdbRating = 8;
    original.bundle[field] = 7;
    const seed = tab(worker); await seed.loadPersistedRatings();
    seed.ratingsCache.set('movie:1', original); await seed.flushPersistedRatings();
    const native = tab(worker), shared = tab(worker);
    await Promise.all([native.loadPersistedRatings(), shared.loadPersistedRatings()]);
    // Two checks can finish in the same millisecond. Only one tab refreshed
    // native data; the other still carries its unchanged original snapshot.
    native.ratingsCache.set('movie:1', { ...original, bundle: { ...original.bundle, [field]: 9 }, retryAt: now + 5000 });
    shared.ratingsCache.set('movie:1', { ...original, bundle: { ...original.bundle, rtCriticsScore: 95, rtAudienceScore: 90 }, publicCheckedAt: now });
    for (const cache of publicFirst ? [shared, native] : [native, shared]) await cache.flushPersistedRatings();
    const result = stored(worker).entries['movie:1'];
    assert.equal(result.bundle[field], 9, 'an unchanged native snapshot must not undo another tab\'s refresh');
    assert.equal(result.bundle.rtCriticsScore, 95);
    assert.equal(result.retryAt, now + 5000, 'public reconciliation must preserve the native retry deadline');
    assert.equal(result.diagnostics.status, 'rated', 'diagnostics must describe the completed merged bundle');
    const reloaded = tab(worker); await reloaded.loadPersistedRatings();
    assert.equal(reloaded.ratingsCache.get('movie:1').bundle[field], 9);
  });
}

test('a same-time refresh that changes native and public scores still applies its native changes', async () => {
  const worker = await setup(), now = Date.now();
  const original = { ...entry(20, now - 1000), publicCheckedAt: now - 2000 };
  original.bundle.imdbRating = 7;
  const seed = tab(worker); await seed.loadPersistedRatings();
  seed.ratingsCache.set('movie:1', original); await seed.flushPersistedRatings();
  const a = tab(worker), b = tab(worker);
  await Promise.all([a.loadPersistedRatings(), b.loadPersistedRatings()]);
  a.ratingsCache.set('movie:1', { ...original, bundle: { ...original.bundle, imdbRating: 9 } });
  await a.flushPersistedRatings();
  b.ratingsCache.set('movie:1', { ...original, bundle: { ...original.bundle, rtCriticsScore: 95, imdbRating: 8 }, publicCheckedAt: now });
  await b.flushPersistedRatings();
  const result = stored(worker).entries['movie:1'];
  assert.equal(result.bundle.imdbRating, 8, 'an actual native change must not be classified as a public-only reconciliation');
  assert.equal(result.bundle.rtCriticsScore, 95);
});

for (const mediaType of ['movie', 'tv']) for (const imdbFirst of [true, false]) test(`complementary native ${mediaType} refreshes retain both scores (${imdbFirst ? 'IMDb' : 'TMDB'} first)`, async () => {
  const worker = await setup();
  const seed = tab(worker); await seed.loadPersistedRatings();
  const at = Date.now();
  const key = `${mediaType}:1`;
  const original = { ...entry(90, at - 1000), bundle: Model.createRatingsBundle({ rtCriticsScore: 90, rtAudienceScore: 80, confidence: 1 }), retryAt: at + Config.partialRatingsRetryMs,
    diagnostics: { status: 'partial', checkedAt: at - 1000, source: 'seerr-ratings-api' } };
  seed.ratingsCache.set(key, original); await seed.flushPersistedRatings();
  const imdb = tab(worker), tmdb = tab(worker);
  await Promise.all([imdb.loadPersistedRatings(), tmdb.loadPersistedRatings()]);
  imdb.ratingsCache.set(key, { ...original, bundle: { ...original.bundle, imdbRating: 8 }, cachedAt: at });
  tmdb.ratingsCache.set(key, { ...original, bundle: { ...original.bundle, tmdbRating: 9 }, cachedAt: at + 1 });
  for (const cache of imdbFirst ? [imdb, tmdb] : [tmdb, imdb]) await cache.flushPersistedRatings();
  const result = stored(worker).entries[key];
  assert.equal(result.bundle.imdbRating, 8, 'the other tab did not find IMDb; it must not erase the score');
  assert.equal(result.bundle.tmdbRating, 9);
  assert.equal(result.cachedAt, at + 1);
  assert.equal(result.bundle.rtCriticsScore, 90);
  assert.equal(result.diagnostics.status, 'rated', 'the combined bundle is complete');
  const reloaded = tab(worker); await reloaded.loadPersistedRatings();
  assert.equal(reloaded.ratingsCache.get(key).bundle.imdbRating, 8);
  assert.equal(reloaded.ratingsCache.get(key).bundle.tmdbRating, 9);
});

for (const field of ['imdbRating', 'tmdbRating']) for (const removeFirst of [true, false]) {
  test(`an explicit ${field} removal stays authoritative (${removeFirst ? 'removal' : 'update'} first)`, async () => {
    const worker = await setup();
    const seed = tab(worker); await seed.loadPersistedRatings();
    const at = Date.now();
    const original = { ...entry(90, at - 1000), bundle: Model.createRatingsBundle({ rtCriticsScore: 90, [field]: 7, confidence: 1 }) };
    seed.ratingsCache.set('movie:1', original); await seed.flushPersistedRatings();
    const update = tab(worker), remove = tab(worker);
    await Promise.all([update.loadPersistedRatings(), remove.loadPersistedRatings()]);
    update.ratingsCache.set('movie:1', { ...original, bundle: { ...original.bundle, [field]: 8 }, cachedAt: at });
    remove.ratingsCache.set('movie:1', { ...original, bundle: { ...original.bundle, [field]: null }, cachedAt: at + 1 });
    for (const cache of removeFirst ? [remove, update] : [update, remove]) await cache.flushPersistedRatings();
    assert.equal(stored(worker).entries['movie:1'].bundle[field], null);
    assert.equal(stored(worker).entries['movie:1'].cachedAt, at + 1);
  });
}

for (const field of ['imdbRating', 'tmdbRating']) test(`a delayed ${field} discovery cannot undo a subsequent explicit removal`, async () => {
  const worker = await setup();
  const at = Date.now();
  const seed = tab(worker); await seed.loadPersistedRatings();
  const original = entry(90, at - 1000);
  seed.ratingsCache.set('movie:1', original); await seed.flushPersistedRatings();
  let activeWorker = worker;
  const delayed = tab(worker, { send: async message => ({ success: true, data: message.action === 'getOverlayCache'
    ? await activeWorker.api.getOverlayCache(sender) : await activeWorker.api.putOverlayCache(message.data, sender) }) });
  const current = tab(worker);
  await Promise.all([delayed.loadPersistedRatings(), current.loadPersistedRatings()]);
  current.ratingsCache.set('movie:1', { ...original, bundle: { ...original.bundle, [field]: 7 }, cachedAt: at });
  await current.flushPersistedRatings();
  current.ratingsCache.set('movie:1', { ...original, cachedAt: at + 2 });
  await current.flushPersistedRatings();
  // Restart the worker to prove the deletion boundary survives persistence.
  const restarted = await setup(worker.localStore);
  const resumed = tab(restarted);
  await resumed.loadPersistedRatings();
  // The old tab's delta carries the original missing-field snapshot.
  activeWorker = restarted;
  delayed.ratingsCache.set('movie:1', { ...original, bundle: { ...original.bundle, [field]: 8 }, cachedAt: at + 1 });
  await delayed.flushPersistedRatings();
  assert.equal(stored(restarted).entries['movie:1'].bundle[field], null);
  resumed.ratingsCache.set('movie:1', { ...original, bundle: { ...original.bundle, [field]: 9 }, cachedAt: at + 3 });
  await resumed.flushPersistedRatings();
  assert.equal(stored(restarted).entries['movie:1'].bundle[field], 9, 'a genuinely newer discovery still applies');
  assert.equal(stored(restarted).entries['movie:1'].nativeRemovedAt, undefined, 'a new discovery retires the removal marker');
});

for (const field of ['imdbRating', 'tmdbRating']) for (const reload of [false, true]) {
  test(`forgetting an unchanged ${field} removal works ${reload ? 'after reload' : 'in its original tab'}`, async () => {
    const worker = await setup();
    const at = Date.now();
    const seed = tab(worker); await seed.loadPersistedRatings();
    const original = { ...entry(90, at - 1000), bundle: Model.createRatingsBundle({ rtCriticsScore: 90, [field]: 7, confidence: 1 }) };
    seed.ratingsCache.set('movie:1', original); await seed.flushPersistedRatings();
    const writer = tab(worker); await writer.loadPersistedRatings();
    writer.ratingsCache.set('movie:1', { ...original, bundle: { ...original.bundle, [field]: null }, cachedAt: at });
    await writer.flushPersistedRatings();
    assert.equal(stored(worker).entries['movie:1'].nativeRemovedAt[field], at);
    const forgetting = reload ? tab(worker) : writer;
    if (reload) await forgetting.loadPersistedRatings();
    forgetting.ratingsCache.delete('movie:1'); await forgetting.flushPersistedRatings();
    assert.equal(stored(worker).entries['movie:1'], undefined, 'worker removal metadata must not make an unchanged snapshot impossible to forget');
  });
}

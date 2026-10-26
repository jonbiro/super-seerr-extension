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
  assert.equal(localStore.overlayRatingsByServerV1, undefined);
  await assert.rejects(api.putOverlayCache(blob({ epoch: localStore.ratingsCacheEpoch, extra: 'x'.repeat(3_000_001) }), sender), /size limit/);
});

test('cache clearing waits for an in-flight write and remains cleared after it completes', async () => {
  const worker = await setup();
  let release, announce;
  const entered = new Promise(resolve => { announce = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const original = worker.context.chrome.storage.local.set;
  worker.context.chrome.storage.local.set = async value => {
    if (value.overlayRatingsByServerV1) { announce(); await gate; }
    await original(value);
  };
  const writing = worker.api.putOverlayCache(blob(), sender);
  await entered;
  const clearing = worker.api.clearRatingsCache();
  release(); await Promise.all([writing, clearing]);
  assert.equal(worker.localStore.overlayRatingsV1, undefined);
  assert.equal(worker.localStore.overlayRatingsByServerV1, undefined);
  assert.notEqual(worker.localStore.ratingsCacheEpoch, 0);
});

test('each site retains its own ratings and title index across switches and worker restarts', async () => {
  const worker = await setup();
  const sites = [server, 'https://seerr.example:8443/base/', 'https://seerr.example/other/', 'https://other.example/'];
  for (const [i, url] of sites.entries()) {
    worker.api.baseUrl = url;
    const entry = blob({ server: url, index: [{ tmdbId: String(i + 1), mediaType: 'movie', title: `Site ${i}` }] });
    entry.entries['movie:1'].bundle.rtCriticsScore = i * 20;
    await worker.api.putOverlayCache(entry, { ...sender, url: `${url}discover` });
  }
  const restarted = await setup(worker.localStore);
  for (const [i, url] of sites.entries()) {
    restarted.api.baseUrl = url;
    const cached = (await restarted.api.getOverlayCache({ ...sender, url: `${url}discover` })).overlayRatingsV1;
    assert.equal(cached.entries['movie:1'].bundle.rtCriticsScore, i * 20);
    assert.equal(cached.index[0].title, `Site ${i}`);
  }
  assert.equal(Object.keys(worker.localStore.overlayRatingsByServerV1).length, 4);
  await restarted.api.clearRatingsCache();
  assert.equal(restarted.localStore.overlayRatingsByServerV1, undefined);
  assert.equal((await restarted.api.getOverlayCache({ ...sender, url: `${sites.at(-1)}discover` })).overlayRatingsV1, null);
});

test('legacy cache migrates without losing it when another site writes first', async () => {
  const worker = await setup({ overlayRatingsV1: blob() });
  worker.api.baseUrl = 'https://other.example/';
  const other = { ...sender, url: 'https://other.example/discover' };
  await worker.api.putOverlayCache(blob({ server: worker.api.baseUrl, entries: {} }), other);
  assert.equal(worker.localStore.overlayRatingsV1, null);
  worker.api.baseUrl = server.replace(/\/$/, '');
  const cached = (await worker.api.getOverlayCache(sender)).overlayRatingsV1;
  assert.equal(cached.server, worker.api.baseUrl);
  assert.equal(cached.entries['movie:1'].bundle.rtCriticsScore, 75);
});

test('reading migrates the legacy cache and keeps newer per-site data authoritative', async () => {
  const worker = await setup({ overlayRatingsV1: blob() });
  assert.equal((await worker.api.getOverlayCache(sender)).overlayRatingsV1.entries['movie:1'].bundle.rtCriticsScore, 75);
  assert.equal(worker.localStore.overlayRatingsV1, null);
  worker.localStore.overlayRatingsV1 = blob({ entries: {} });
  assert.equal((await worker.api.getOverlayCache(sender)).overlayRatingsV1.entries['movie:1'].bundle.rtCriticsScore, 75);
});

test('multi-site writes are serialized and inactive pages cannot replace another cache', async () => {
  const worker = await setup();
  const second = 'https://other.example/';
  const other = { ...sender, url: second + 'discover' };
  let release, announce;
  const entered = new Promise(resolve => { announce = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const original = worker.context.chrome.storage.local.set;
  worker.context.chrome.storage.local.set = async value => { announce(); await gate; await original(value); };
  const firstWrite = worker.api.putOverlayCache(blob(), sender);
  await entered;
  worker.api.baseUrl = second;
  const secondWrite = worker.api.putOverlayCache(blob({ server: second }), other);
  release(); await Promise.all([firstWrite, secondWrite]);
  assert.equal(Object.keys(worker.localStore.overlayRatingsByServerV1).length, 2);
  await assert.rejects(worker.api.putOverlayCache(blob(), sender));
  await assert.rejects(worker.api.getOverlayCache(sender));
});

test('cache byte budgets retain recent data for all ten sites', async () => {
  const worker = await setup();
  const entries = Object.fromEntries(Array.from({ length: 2200 }, (_, i) => [`movie:${i + 1}`, {
    bundle: { rtCriticsScore: 75, source: '評'.repeat(100) }, cachedAt: i
  }]));
  const index = Array.from({ length: 1200 }, (_, i) => ({ tmdbId: String(i + 1), mediaType: 'movie', title: '影'.repeat(250) }));
  for (let i = 0; i < 10; i++) {
    const url = `https://site${i}.example/`;
    worker.api.baseUrl = url;
    await worker.api.putOverlayCache(blob({ server: url, entries, index }), { ...sender, url });
  }
  const caches = worker.localStore.overlayRatingsByServerV1;
  assert.equal(Object.keys(caches).length, 10);
  assert.ok(Buffer.byteLength(JSON.stringify(caches)) < 6_100_000);
  for (const cache of Object.values(caches)) {
    assert.ok(cache.entries['movie:2200']);
    assert.equal(cache.index.at(-1).tmdbId, '1200');
  }
});

test('local storage uses trusted access when available and preserves unsupported-browser behavior', async () => {
  const worker = await setup();
  assert.equal(await worker.api.restrictLocalStorage(), false);
  let level;
  worker.context.chrome.storage.local.setAccessLevel = async value => { level = value.accessLevel; };
  assert.equal(await worker.api.restrictLocalStorage(), true);
  assert.equal(level, 'TRUSTED_CONTEXTS');
});

test('a rejected storage access restriction does not block worker startup', async () => {
  const worker = await setup();
  worker.context.chrome.storage.local.setAccessLevel = async () => { throw new Error('unsupported'); };
  await assert.doesNotReject(() => worker.api.restrictLocalStorage());
});

test('cache sanitization retains the newest entries when storage object order is stale', async () => {
  const worker = await setup();
  const previous = worker.context.RatingsConfig.overlayCacheMaxEntries;
  worker.context.RatingsConfig.overlayCacheMaxEntries = 2;
  try {
    const value = blob({ entries: {
      'movie:3': { bundle: { rtCriticsScore: 95, confidence: 1 }, cachedAt: 300 },
      'movie:1': { bundle: { rtCriticsScore: 75, confidence: 1 }, cachedAt: 100 },
      'movie:2': { bundle: { rtCriticsScore: 85, confidence: 1 }, cachedAt: 200 }
    } });
    const clean = worker.api.sanitizeOverlayCache(value, server, 0);
    assert.deepEqual(Object.keys(clean.entries).sort(), ['movie:2', 'movie:3']);
  } finally {
    worker.context.RatingsConfig.overlayCacheMaxEntries = previous;
  }
});

test('invalid cache records cannot consume the newest-entry bound', async () => {
  const worker = await setup();
  const previous = worker.context.RatingsConfig.overlayCacheMaxEntries;
  worker.context.RatingsConfig.overlayCacheMaxEntries = 2;
  try {
    const value = blob({ entries: {
      'not-a-media-key': { bundle: { rtCriticsScore: 99, confidence: 1 }, cachedAt: Number.MAX_SAFE_INTEGER },
      'movie:1': { bundle: { rtCriticsScore: 75, confidence: 1 }, cachedAt: 100 },
      'movie:2': { bundle: { rtCriticsScore: 85, confidence: 1 }, cachedAt: 200 }
    } });
    const clean = worker.api.sanitizeOverlayCache(value, server, 0);
    assert.deepEqual(Object.keys(clean.entries).sort(), ['movie:1', 'movie:2']);
  } finally {
    worker.context.RatingsConfig.overlayCacheMaxEntries = previous;
  }
});

test('invalid title-index records cannot consume the index bound', async () => {
  const worker = await setup();
  const previous = worker.context.RatingsConfig.listIndexMaxEntries;
  worker.context.RatingsConfig.listIndexMaxEntries = 2;
  try {
    const value = blob({ index: [
      { tmdbId: '1', mediaType: 'movie', title: 'First' },
      { tmdbId: 'not-an-id', mediaType: 'movie', title: 'Invalid' },
      { tmdbId: '2', mediaType: 'movie', title: 'Second' }
    ] });
    const clean = worker.api.sanitizeOverlayCache(value, server, 0);
    assert.deepEqual(clean.index.map(item => item.tmdbId), ['1', '2']);
  } finally {
    worker.context.RatingsConfig.listIndexMaxEntries = previous;
  }
});

test('title-index sanitization canonicalizes IDs and rejects unsafe values', async () => {
  const worker = await setup();
  const previous = worker.context.RatingsConfig.listIndexMaxEntries;
  worker.context.RatingsConfig.listIndexMaxEntries = 10;
  const value = blob({ index: [
    { tmdbId: '000123', mediaType: 'movie', title: 'Leading zeros' },
    { tmdbId: [456], mediaType: 'movie', title: 'Array ID' },
    { tmdbId: '999999999999999999', mediaType: 'movie', title: 'Unsafe ID' },
    { tmdbId: '789', mediaType: 'tv', title: 'Valid series' }
  ] });
  try {
    const clean = worker.api.sanitizeOverlayCache(value, server, 0);
    assert.deepEqual(clean.index.map(item => `${item.mediaType}:${item.tmdbId}`), ['movie:123', 'tv:789']);
  } finally {
    worker.context.RatingsConfig.listIndexMaxEntries = previous;
  }
});

test('site cache retention keeps the newest sites when storage object order is stale', async () => {
  const records = {};
  const order = [10, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (const i of order) {
    const site = `https://site${i}.example/`;
    records[site.slice(0, -1)] = blob({ server: site, entries: {
      'movie:1': { bundle: { rtCriticsScore: i, confidence: 1 }, cachedAt: i + 1 }
    } });
  }
  const worker = await setup({ overlayRatingsByServerV1: records });
  worker.api.baseUrl = 'https://site10.example';
  const result = await worker.api.getOverlayCache({ ...sender, url: 'https://site10.example/discover' });
  assert.equal(result.overlayRatingsV1?.entries['movie:1']?.bundle.rtCriticsScore, 10);
});

test('duplicate normalized server records keep the freshest cache regardless of object order', async () => {
  const older = blob({ server: 'https://seerr.example/base/', entries: {
    'movie:1': { bundle: { rtCriticsScore: 10, confidence: 1 }, cachedAt: 100 }
  } });
  const newer = blob({ server: 'https://seerr.example/base', entries: {
    'movie:1': { bundle: { rtCriticsScore: 90, confidence: 1 }, cachedAt: 200 }
  } });
  const worker = await setup({ overlayRatingsByServerV1: {
    'https://seerr.example/base': newer,
    'https://seerr.example/base/': older
  } });
  const caches = worker.api.overlayCachesFromStorage(worker.localStore, 0);
  assert.equal(caches['https://seerr.example/base'].entries['movie:1'].bundle.rtCriticsScore, 90);
});

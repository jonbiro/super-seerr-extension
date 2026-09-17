// The overlay's ratings cache used to live only in memory with a five-minute
// TTL, so every fresh visit to Seerr re-resolved every card. It now persists
// to storage.local with no expiry, cleared explicitly from Settings.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Config = require('../src/shared/RatingsConfig');
const { loadOverlay } = require('./helpers/overlay');

const CACHE_KEY = 'overlayRatingsV1';
const SERVER = 'https://seerr.example/';
const settings = { seerrUrl: SERVER };

// Resolves ratings without any network, counting how often it is asked.
function withResolver(overlay, bundleFor) {
  const resolved = [];
  overlay.setResolver(async (tmdbId, title, year, mediaType) => {
    resolved.push(tmdbId);
    return overlay.Model.createRatingsBundle(bundleFor(tmdbId));
  });
  // The overlay resolves its own detail route on load, so callers count only
  // the title they asked for.
  resolved.timesFor = tmdbId => resolved.filter(id => id === tmdbId).length;
  return resolved;
}

const scored = tmdbId => ({ rtCriticsScore: 80, rtAudienceScore: 90, imdbRating: 7.5, tmdbRating: 7 });

test('a resolved bundle is written to local storage', async () => {
  const overlay = loadOverlay({ settings });
  withResolver(overlay, scored);

  await overlay.getRatings(550, 'Fight Club', 1999, 'movie');
  await overlay.flushPersistedRatings();

  const stored = overlay.localStore[CACHE_KEY];
  assert.ok(stored, 'the cache should be persisted');
  assert.equal(stored.server, SERVER, 'entries record which server they came from');
  assert.equal(stored.entries['movie:550'].rtCriticsScore, 80);
});

test('a reloaded page serves the stored rating without resolving again', async () => {
  const first = loadOverlay({ settings });
  withResolver(first, scored);
  await first.getRatings(550, 'Fight Club', 1999, 'movie');
  await first.flushPersistedRatings();

  // A fresh overlay is what a page reload produces: empty memory, same storage.
  const second = loadOverlay({ settings, local: first.localStore });
  const resolved = withResolver(second, scored);

  const bundle = await second.getRatings(550, 'Fight Club', 1999, 'movie');
  assert.equal(resolved.timesFor(550), 0, 'a stored rating must not be resolved again');
  assert.equal(bundle.rtCriticsScore, 80);
  assert.equal(bundle.imdbRating, 7.5);
});

test('entries saved against a different server are discarded', async () => {
  const stale = { [CACHE_KEY]: { server: 'https://other.example/', entries: { 'movie:550': scored(550) } } };
  const overlay = loadOverlay({ settings, local: stale });
  const resolved = withResolver(overlay, scored);

  await overlay.getRatings(550, 'Fight Club', 1999, 'movie');
  assert.equal(resolved.timesFor(550), 1, 'another server\'s ratings must not be served');
});

test('a bundle with no scores at all is not persisted', async () => {
  const overlay = loadOverlay({ settings });
  withResolver(overlay, () => ({}));

  await overlay.getRatings(550, 'Fight Club', 1999, 'movie');
  await overlay.flushPersistedRatings();

  const stored = overlay.localStore[CACHE_KEY];
  // Without an expiry, storing "found nothing" would mean never looking again.
  assert.ok(!stored || !stored.entries['movie:550'], 'an empty bundle must not be stored');
});

test('a partial bundle is still persisted', async () => {
  const overlay = loadOverlay({ settings });
  withResolver(overlay, () => ({ rtCriticsScore: 80 }));

  await overlay.getRatings(550, 'Fight Club', 1999, 'movie');
  await overlay.flushPersistedRatings();

  assert.equal(overlay.localStore[CACHE_KEY].entries['movie:550'].rtCriticsScore, 80);
});

test('the cache stays within its entry cap', async () => {
  const overlay = loadOverlay({ settings });
  withResolver(overlay, scored);

  for (let i = 0; i < Config.cacheMaxEntries + 25; i++) {
    await overlay.getRatings(i, `Title ${i}`, 2000, 'movie');
  }
  await overlay.flushPersistedRatings();

  assert.ok(overlay.ratingsCache.size <= Config.cacheMaxEntries, `in-memory cache grew to ${overlay.ratingsCache.size}`);
  assert.ok(Object.keys(overlay.localStore[CACHE_KEY].entries).length <= Config.cacheMaxEntries);
});

test('the cap evicts least recently used, not merely oldest', async () => {
  const overlay = loadOverlay({ settings });
  withResolver(overlay, scored);

  // Fill exactly to the cap: ids 1..cacheMaxEntries.
  for (let i = 1; i <= Config.cacheMaxEntries; i++) await overlay.getRatings(i, `Title ${i}`, 2000, 'movie');

  // Touch the oldest entry so it is no longer least recently used, then
  // overflow by one so exactly one eviction happens.
  await overlay.getRatings(1, 'First', 2000, 'movie');
  await overlay.getRatings(9001, 'Newest', 2000, 'movie');

  assert.ok(overlay.ratingsCache.has('movie:1'), 'a recently used entry must survive eviction');
  assert.ok(!overlay.ratingsCache.has('movie:2'), 'the genuinely least recently used entry goes');
});

test('clearing the cache from Settings empties an open tab', async () => {
  const overlay = loadOverlay({ settings });
  const resolved = withResolver(overlay, scored);
  await overlay.getRatings(550, 'Fight Club', 1999, 'movie');
  assert.equal(resolved.timesFor(550), 1);

  // Settings removes the key; the overlay sees it through storage.onChanged.
  delete overlay.localStore[CACHE_KEY];
  overlay.changeLocal({ [CACHE_KEY]: { oldValue: { server: SERVER, entries: {} } } });

  await overlay.getRatings(550, 'Fight Club', 1999, 'movie');
  assert.equal(resolved.timesFor(550), 2, 'after clearing, the rating must be resolved again');
});

test('the overlay\'s own writes do not wipe its cache', async () => {
  const overlay = loadOverlay({ settings });
  const resolved = withResolver(overlay, scored);
  await overlay.getRatings(550, 'Fight Club', 1999, 'movie');

  // A flush fires onChanged in this same tab; that must not be read as a clear.
  overlay.changeLocal({ [CACHE_KEY]: { newValue: { server: SERVER, entries: {} }, oldValue: undefined } });

  await overlay.getRatings(550, 'Fight Club', 1999, 'movie');
  assert.equal(resolved.timesFor(550), 1, 'a write is not a clear');
});

test('a corrupt stored cache degrades to a cold start', async () => {
  for (const stored of ['nonsense', 42, null, { server: SERVER }, { server: SERVER, entries: 'bad' }, { entries: {} }]) {
    const overlay = loadOverlay({ settings, local: { [CACHE_KEY]: stored } });
    const resolved = withResolver(overlay, scored);
    const bundle = await overlay.getRatings(550, 'Fight Club', 1999, 'movie');
    assert.equal(resolved.timesFor(550), 1, `should recover from ${JSON.stringify(stored)}`);
    assert.equal(bundle.rtCriticsScore, 80);
  }
});

test('a live in-memory entry wins over a stored one', async () => {
  const stored = { [CACHE_KEY]: { server: SERVER, entries: { 'movie:550': { ...scored(550), rtCriticsScore: 11 } } } };
  const overlay = loadOverlay({ settings, local: stored });
  withResolver(overlay, scored);

  // Resolve once in this session, then read again.
  const fresh = await overlay.getRatings(551, 'Other', 2000, 'movie');
  assert.equal(fresh.rtCriticsScore, 80);
  const reread = await overlay.getRatings(551, 'Other', 2000, 'movie');
  assert.equal(reread.rtCriticsScore, 80);
});

test('storing a bundle schedules the write on its own', async () => {
  // Without this the suite would still pass with the automatic flush removed,
  // because every other test calls flushPersistedRatings() by hand.
  const overlay = loadOverlay({ settings });
  withResolver(overlay, scored);

  await overlay.getRatings(550, 'Fight Club', 1999, 'movie');
  assert.ok(!overlay.localStore[CACHE_KEY], 'the write is debounced, not immediate');

  overlay.runTimers(600);
  await new Promise(resolve => setImmediate(resolve));

  assert.ok(overlay.localStore[CACHE_KEY], 'the debounced write must fire without being called by hand');
  assert.equal(overlay.localStore[CACHE_KEY].entries['movie:550'].rtCriticsScore, 80);
});

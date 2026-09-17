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
  // Entries wrap the bundle so they can record when it was resolved.
  assert.equal(stored.entries['movie:550'].bundle.rtCriticsScore, 80);
  assert.equal(typeof stored.entries['movie:550'].cachedAt, 'number');
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

test('a title nothing knows about is remembered, so the next visit stops asking', async () => {
  // Not storing the absence meant every visit to the same page re-ran the same
  // lookups and drew the same 404s from Seerr's ratings endpoints, for titles
  // that are simply not rated anywhere yet.
  const overlay = loadOverlay({ settings });
  const resolved = withResolver(overlay, () => ({}));

  await overlay.getRatings(550, 'Fight Club', 1999, 'movie');
  await overlay.getRatings(550, 'Fight Club', 1999, 'movie');
  assert.equal(resolved.timesFor(550), 1, 'the second visit must not ask again');

  await overlay.flushPersistedRatings();
  const entry = overlay.localStore[CACHE_KEY].entries['movie:550'];
  assert.equal(entry.bundle, null, 'stored as an absence, not as a score');
  assert.equal(typeof entry.cachedAt, 'number', 'and only with the timestamp that lets it expire');
});

test('a remembered absence expires, because an unrated film is unrated only for now', async () => {
  const old = Date.now() - Config.unratedRetryMs - 1000;
  const overlay = loadOverlay({
    settings,
    local: { [CACHE_KEY]: { server: SERVER, matcher: Config.matcherVersion, entries: {
      'movie:550': { bundle: null, cachedAt: old }
    } } }
  });
  const resolved = withResolver(overlay, () => ({ rtCriticsScore: 80 }));

  const bundle = await overlay.getRatings(550, 'Fight Club', 1999, 'movie');
  assert.equal(resolved.timesFor(550), 1, 'past its expiry it is worth asking again');
  assert.equal(bundle.rtCriticsScore, 80);
});

test('an absence already in memory expires without help from the loader', async () => {
  // The stored-entry path and the in-memory path each drop an expired absence,
  // and either alone makes the other's test pass. This one never loads from
  // storage: the entry is put straight into the live cache.
  const overlay = loadOverlay({ settings });
  const resolved = withResolver(overlay, () => ({ rtCriticsScore: 80 }));
  await overlay.loadPersistedRatings();
  overlay.ratingsCache.set('movie:550', { bundle: null, cachedAt: Date.now() - Config.unratedRetryMs - 1000 });

  const bundle = await overlay.getRatings(550, 'Fight Club', 1999, 'movie');
  assert.equal(resolved.timesFor(550), 1, 'a live entry past its expiry is looked up again');
  assert.equal(bundle.rtCriticsScore, 80);
});

test('an expired absence is not loaded from storage in the first place', async () => {
  const overlay = loadOverlay({
    settings,
    local: { [CACHE_KEY]: { server: SERVER, matcher: Config.matcherVersion, entries: {
      'movie:550': { bundle: null, cachedAt: Date.now() - Config.unratedRetryMs - 1000 },
      'movie:551': { bundle: null, cachedAt: Date.now() }
    } } }
  });
  await overlay.loadPersistedRatings();

  assert.equal(overlay.ratingsCache.has('movie:550'), false, 'the expired one is left behind');
  assert.equal(overlay.ratingsCache.has('movie:551'), true, 'the current one is kept');
});

test('an absence stored without a timestamp is not trusted', async () => {
  // Nothing should write one, but an entry that cannot expire must not be the
  // thing that silences a title forever.
  const overlay = loadOverlay({
    settings,
    local: { [CACHE_KEY]: { server: SERVER, matcher: Config.matcherVersion, entries: {
      'movie:550': { bundle: null, cachedAt: null }
    } } }
  });
  const resolved = withResolver(overlay, () => ({ rtCriticsScore: 80 }));

  await overlay.getRatings(550, 'Fight Club', 1999, 'movie');
  assert.equal(resolved.timesFor(550), 1);
});

test('a partial bundle is still persisted', async () => {
  const overlay = loadOverlay({ settings });
  withResolver(overlay, () => ({ rtCriticsScore: 80 }));

  await overlay.getRatings(550, 'Fight Club', 1999, 'movie');
  await overlay.flushPersistedRatings();

  assert.equal(overlay.localStore[CACHE_KEY].entries['movie:550'].bundle.rtCriticsScore, 80);
});

test('the cache stays within its entry cap', async () => {
  const overlay = loadOverlay({ settings });
  withResolver(overlay, scored);

  for (let i = 0; i < Config.overlayCacheMaxEntries + 25; i++) {
    await overlay.getRatings(i, `Title ${i}`, 2000, 'movie');
  }
  await overlay.flushPersistedRatings();

  assert.ok(overlay.ratingsCache.size <= Config.overlayCacheMaxEntries, `in-memory cache grew to ${overlay.ratingsCache.size}`);
  assert.ok(Object.keys(overlay.localStore[CACHE_KEY].entries).length <= Config.overlayCacheMaxEntries);
});

test('the cap evicts least recently used, not merely oldest', async () => {
  const overlay = loadOverlay({ settings });
  withResolver(overlay, scored);

  // Fill exactly to the cap: ids 1..overlayCacheMaxEntries.
  for (let i = 1; i <= Config.overlayCacheMaxEntries; i++) await overlay.getRatings(i, `Title ${i}`, 2000, 'movie');

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
  const stored = { [CACHE_KEY]: { server: SERVER, entries: { 'movie:550': { bundle: { ...scored(550), rtCriticsScore: 11 }, cachedAt: Date.now() } } } };
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
  assert.equal(overlay.localStore[CACHE_KEY].entries['movie:550'].bundle.rtCriticsScore, 80);
});

test('a lookup that could not complete is not remembered as unrated', async () => {
  // MV3 evicts the worker after seconds of idle, so a sendMessage rejecting
  // mid-burst is ordinary. Treating that as "nothing knows this title" hid a
  // real score for a week — the first version of this cache did exactly that.
  const overlay = loadOverlay({
    settings,
    sendMessage: async () => { throw new Error('Could not establish connection'); }
  });

  const bundle = await overlay.getRatings(550, 'Fight Club', 1999, 'movie');
  assert.equal(bundle.rtCriticsScore, null, 'nothing resolved');
  await overlay.flushPersistedRatings();

  assert.equal(overlay.ratingsCache.has('movie:550'), false, 'the failure must not be cached');
  const stored = overlay.localStore[CACHE_KEY];
  assert.ok(!stored?.entries?.['movie:550'], 'nor persisted');
});

test('a worker that answers "no match" is an answer, and is remembered', async () => {
  const overlay = loadOverlay({ settings, sendMessage: async () => ({ success: true, data: null }) });

  await overlay.getRatings(550, 'Fight Club', 1999, 'movie');
  assert.equal(overlay.ratingsCache.has('movie:550'), true, 'a conclusive nothing is still worth storing');
  assert.equal(overlay.ratingsCache.get('movie:550').bundle, null);
});

test('a worker reporting failure is not an answer either', async () => {
  // The worker can reply rather than throw — Rotten Tomatoes unreachable, a
  // timeout, a parse failure. That reply carries success: false, and it says
  // nothing about whether the title has a score.
  const overlay = loadOverlay({
    settings,
    sendMessage: async () => ({ success: false, error: 'Rotten Tomatoes unreachable' })
  });

  await overlay.getRatings(550, 'Fight Club', 1999, 'movie');
  assert.equal(overlay.ratingsCache.has('movie:550'), false, 'a reported failure must not be cached');
});

test('a Seerr request that never answers leaves the title unremembered', async () => {
  // Rotten Tomatoes can conclusively have no match while Seerr's own endpoints
  // are unreachable. Seerr answering 404 is a fact; a throw is not, and the
  // title may well be rated there once the server is reachable again.
  const overlay = loadOverlay({
    settings,
    sendMessage: async () => ({ success: true, data: null }),
    fetch: async () => { throw new Error('Failed to fetch'); }
  });

  await overlay.getRatings(550, 'Fight Club', 1999, 'movie');
  assert.equal(overlay.ratingsCache.has('movie:550'), false, 'an unreachable server is not a verdict');
});

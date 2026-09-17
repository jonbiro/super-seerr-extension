// Scores move as reviews come in, but cached entries never expire by design.
// Refresh is the escape hatch: it re-resolves the titles on screen, and must
// reach past both caches or it would hand back the same numbers.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker } = require('./helpers/worker');
const { loadOverlay } = require('./helpers/overlay');

const CACHE_KEY = 'overlayRatingsV1';
const SERVER = 'https://seerr.example/';
const settings = { seerrUrl: SERVER };

function withResolver(overlay, bundleFor) {
  const resolved = [];
  overlay.setResolver(async tmdbId => {
    resolved.push(tmdbId);
    return overlay.Model.createRatingsBundle(bundleFor(tmdbId));
  });
  resolved.timesFor = tmdbId => resolved.filter(id => id === tmdbId).length;
  return resolved;
}

// ── Worker: a refresh must not be answered from the Rotten Tomatoes cache ──

test('a refreshed RT lookup bypasses the cached value', async () => {
  const worker = loadWorker();
  let critics = 80;
  worker.api.fetchRtHtml = async () => '';
  worker.api.parseRtSearchResults = () => [{ href: '/m/x', title: 'Example', year: 2020, rtCriticsScore: critics }];
  worker.api.parseRtScorecard = () => ({ rtAudienceScore: 90 });

  assert.equal((await worker.api.getRottenTomatoesRatings({ title: 'Example', year: 2020 })).rtCriticsScore, 80);

  critics = 93; // more reviews landed
  const cached = await worker.api.getRottenTomatoesRatings({ title: 'Example', year: 2020 });
  assert.equal(cached.rtCriticsScore, 80, 'an ordinary lookup still serves the cached score');

  const fresh = await worker.api.getRottenTomatoesRatings({ title: 'Example', year: 2020, refresh: true });
  assert.equal(fresh.rtCriticsScore, 93, 'a refresh must refetch');
});

test('a refreshed result replaces the cached one for later lookups', async () => {
  const worker = loadWorker();
  let critics = 80;
  worker.api.fetchRtHtml = async () => '';
  worker.api.parseRtSearchResults = () => [{ href: '/m/x', title: 'Example', year: 2020, rtCriticsScore: critics }];
  worker.api.parseRtScorecard = () => ({});

  await worker.api.getRottenTomatoesRatings({ title: 'Example', year: 2020 });
  critics = 93;
  await worker.api.getRottenTomatoesRatings({ title: 'Example', year: 2020, refresh: true });

  const after = await worker.api.getRottenTomatoesRatings({ title: 'Example', year: 2020 });
  assert.equal(after.rtCriticsScore, 93, 'the refreshed value becomes the cached value');
});

test('a refresh does not join an ordinary lookup already in flight', async () => {
  const worker = loadWorker();
  let calls = 0;
  worker.api.resolveRottenTomatoesRatings = async () => { calls++; return { rtCriticsScore: calls * 10 }; };

  const [ordinary, refreshed] = await Promise.all([
    worker.api.getRottenTomatoesRatings({ title: 'Same', year: 2020 }),
    worker.api.getRottenTomatoesRatings({ title: 'Same', year: 2020, refresh: true })
  ]);
  assert.equal(calls, 2, 'a refresh must resolve on its own, not share a stale in-flight result');
  assert.notEqual(ordinary.rtCriticsScore, refreshed.rtCriticsScore);
});

// ── Overlay: refresh the titles on screen ──

test('refreshing re-resolves a title that was served from cache', async () => {
  const overlay = loadOverlay({ settings });
  const resolved = withResolver(overlay, () => ({ rtCriticsScore: 80 }));

  await overlay.getRatings(550, 'Fight Club', 1999, 'movie');
  await overlay.getRatings(550, 'Fight Club', 1999, 'movie');
  assert.equal(resolved.timesFor(550), 1, 'the second read is a cache hit');

  overlay.forgetRatings([{ tmdbId: 550, mediaType: 'movie' }]);
  await overlay.getRatings(550, 'Fight Club', 1999, 'movie');
  assert.equal(resolved.timesFor(550), 2, 'after forgetting it must resolve again');
});

test('refreshing leaves titles that are not on screen alone', async () => {
  const overlay = loadOverlay({ settings });
  const resolved = withResolver(overlay, () => ({ rtCriticsScore: 80 }));

  await overlay.getRatings(550, 'On screen', 1999, 'movie');
  await overlay.getRatings(603, 'Elsewhere', 1999, 'movie');

  overlay.forgetRatings([{ tmdbId: 550, mediaType: 'movie' }]);

  await overlay.getRatings(603, 'Elsewhere', 1999, 'movie');
  assert.equal(resolved.timesFor(603), 1, 'an untouched title stays cached');
  await overlay.getRatings(550, 'On screen', 1999, 'movie');
  assert.equal(resolved.timesFor(550), 2);
});

test('forgetting a title also drops it from storage', async () => {
  const overlay = loadOverlay({ settings });
  withResolver(overlay, () => ({ rtCriticsScore: 80 }));
  await overlay.getRatings(550, 'Fight Club', 1999, 'movie');
  await overlay.flushPersistedRatings();
  assert.ok(overlay.localStore[CACHE_KEY].entries['movie:550']);

  // Drain the write already pending from the lookup above, so what follows
  // measures only what forgetting schedules. Without this the stale timer
  // writes the post-forget state anyway and the assertion proves nothing.
  overlay.runTimers(600);
  await new Promise(resolve => setImmediate(resolve));

  overlay.forgetRatings([{ tmdbId: 550, mediaType: 'movie' }]);
  assert.equal(overlay.runTimers(600), 1, 'forgetting must schedule a write of its own');
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(!overlay.localStore[CACHE_KEY].entries['movie:550'], 'a forgotten title must not survive in storage');
});

// ── Staleness ──

test('entries record when they were cached, and it survives a reload', async () => {
  const before = Date.now();
  const first = loadOverlay({ settings });
  withResolver(first, () => ({ rtCriticsScore: 80 }));
  await first.getRatings(550, 'Fight Club', 1999, 'movie');
  await first.flushPersistedRatings();

  const entry = first.localStore[CACHE_KEY].entries['movie:550'];
  assert.ok(entry.cachedAt >= before, 'the entry should record when it was resolved');
  assert.equal(entry.bundle.rtCriticsScore, 80);

  const second = loadOverlay({ settings, local: first.localStore });
  withResolver(second, () => ({ rtCriticsScore: 80 }));
  await second.getRatings(550, 'Fight Club', 1999, 'movie');
  assert.equal(second.ratingsCacheAge([{ tmdbId: 550, mediaType: 'movie' }]), entry.cachedAt);
});

test('entries scored under older matching rules are looked up again', async () => {
  // A stored bundle carries its confidence, and a cache hit never re-runs the
  // matcher, so tightening the match rules left every cached title wearing the
  // old verdict: scores that are now exact still displayed as approximate.
  // Anything stored without the current matcher stamp is resolved afresh.
  const stale = { [CACHE_KEY]: { server: SERVER, matcher: 1, entries: {
    'movie:550': { bundle: { rtCriticsScore: 77, confidence: 0.97 }, cachedAt: Date.now() }
  } } };
  const overlay = loadOverlay({ settings, local: stale });
  const resolved = withResolver(overlay, () => ({ rtCriticsScore: 77, confidence: 1 }));

  const bundle = await overlay.getRatings(550, 'Fight Club', 1999, 'movie');
  assert.equal(resolved.timesFor(550), 1, 'a stale verdict is not reused');
  assert.equal(bundle.confidence, 1, 'the current rules decide how sure we are');
});

test('the reported age is the oldest of the titles on screen', async () => {
  const day = 24 * 60 * 60 * 1000;
  const stored = {
    [CACHE_KEY]: {
      server: SERVER,
      matcher: 2,
      entries: {
        'movie:1': { bundle: { rtCriticsScore: 80 }, cachedAt: Date.now() - 6 * day },
        'movie:2': { bundle: { rtCriticsScore: 80 }, cachedAt: Date.now() - 1 * day }
      }
    }
  };
  const overlay = loadOverlay({ settings, local: stored });
  withResolver(overlay, () => ({ rtCriticsScore: 80 }));
  await overlay.getRatings(1, 'A', 2000, 'movie');

  const age = overlay.ratingsCacheAge([{ tmdbId: 1, mediaType: 'movie' }, { tmdbId: 2, mediaType: 'movie' }]);
  assert.ok(Date.now() - age >= 6 * day - 1000, 'the oldest entry decides the reported age');
});

test('a refresh bypasses the overlay cache even without forgetting first', async () => {
  // refreshLoadedScores forgets before resolving, so this guard is what makes
  // getRatings(..., { refresh: true }) correct for any other caller.
  const overlay = loadOverlay({ settings });
  const resolved = withResolver(overlay, () => ({ rtCriticsScore: 80 }));

  await overlay.getRatings(550, 'Fight Club', 1999, 'movie');
  assert.equal(resolved.timesFor(550), 1);

  await overlay.getRatings(550, 'Fight Club', 1999, 'movie', { refresh: true });
  assert.equal(resolved.timesFor(550), 2, 'a refresh must not be answered from cache');

  await overlay.getRatings(550, 'Fight Club', 1999, 'movie');
  assert.equal(resolved.timesFor(550), 2, 'and the refreshed value is cached again');
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Config = require('../src/shared/RatingsConfig');
const { loadOverlay } = require('./helpers/overlay');
const settle = () => new Promise(resolve => setImmediate(resolve));
const full = score => ({ rtCriticsScore: score, rtAudienceScore: 85, imdbRating: 8, tmdbRating: 7, confidence: 1 });

async function fixture(partial = false) {
  const overlay = loadOverlay({ settings: { seerrUrl: 'https://seerr.example/' } });
  overlay.setResolver(async () => overlay.Model.createRatingsBundle(partial ? { tmdbRating: 7 } : full(80)));
  await overlay.getRatings(550, 'Example', 2020, 'movie');
  return overlay;
}

test('aging scores return immediately and share one background refresh', async () => {
  const overlay = await fixture();
  const entry = overlay.ratingsCache.get('movie:550'); entry.retryAt = Date.now() - 1;
  let finish, calls = 0;
  overlay.setResolver(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
  const results = await Promise.all(Array.from({ length: 8 }, () => overlay.getRatings(550, 'Example', 2020, 'movie')));
  assert.ok(results.every(bundle => bundle.rtCriticsScore === 80));
  await settle(); assert.equal(calls, 1);
  finish(overlay.Model.createRatingsBundle(full(95))); await settle();
  assert.equal((await overlay.getRatings(550, 'Example', 2020, 'movie')).rtCriticsScore, 95);
});

test('partial results retry sooner than complete results', async () => {
  const partial = await fixture(true), complete = await fixture();
  const p = partial.ratingsCache.get('movie:550'), c = complete.ratingsCache.get('movie:550');
  assert.equal(p.retryAt - p.cachedAt, Config.partialRatingsRetryMs);
  assert.equal(c.retryAt - c.cachedAt, Config.ratingsFreshMs);
  assert.ok(Config.partialRatingsRetryMs < Config.ratingsFreshMs);
});

test('failed refresh preserves known scores and schedules a short retry', async () => {
  const overlay = await fixture();
  overlay.ratingsCache.get('movie:550').retryAt = Date.now() - 1;
  overlay.setResolver(async (_id, _title, _year, _type, options) => { options.outcome.conclusive = false; return null; });
  assert.equal((await overlay.getRatings(550, 'Example', 2020, 'movie')).rtCriticsScore, 80);
  await settle();
  const entry = overlay.ratingsCache.get('movie:550');
  assert.equal(entry.bundle.rtCriticsScore, 80);
  assert.equal(entry.diagnostics.status, 'failed');
  assert.equal(entry.retryAt - entry.cachedAt, Config.inconclusiveRetryMs);
});

test('a cleared in-flight refresh cannot restore the removed entry', async () => {
  const overlay = await fixture();
  overlay.ratingsCache.get('movie:550').retryAt = Date.now() - 1;
  let finish;
  overlay.setResolver(() => new Promise(resolve => { finish = resolve; }));
  await overlay.getRatings(550, 'Example', 2020, 'movie'); await settle();
  overlay.ratingsCache.clear();
  finish(overlay.Model.createRatingsBundle(full(99))); await settle();
  assert.equal(overlay.ratingsCache.has('movie:550'), false);
});

test('uncertain worker matches remain distinguishable from unrated titles', async () => {
  const overlay = loadOverlay({
    settings: { seerrUrl: 'https://seerr.example/' },
    sendMessage: async () => ({ success: true, data: null, diagnostic: 'uncertain' }),
    fetch: async () => ({ ok: false, status: 404 })
  });
  await overlay.getRatings(550, 'Example', 2020, 'movie');
  assert.equal(overlay.ratingsCache.get('movie:550').diagnostics.status, 'uncertain');
});

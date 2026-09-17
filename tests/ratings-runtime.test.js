const { test } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const { loadOverlay } = require('./helpers/overlay');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('production cascade fills native TMDB data with audience-only RT and session IMDb', async () => {
  const calls = [];
  const overlay = loadOverlay({
    scripts: [{ props: { pageProps: { media: { id: 1, voteAverage: 7.5 } } } }],
    sendMessage: async message => {
      calls.push(message);
      return { success: true, data: { rtAudienceScore: 85, confidence: 0.82 } };
    },
    fetch: async () => ({ ok: true, json: async () => ({ imdbRating: 7.1 }) })
  });
  const result = await overlay.getRatings(1, 'Example', null, 'movie');
  assert.equal(calls.length, 1);
  assert.equal(result.rtAudienceScore, 85);
  assert.equal(result.rtCriticsScore, null);
  assert.equal(result.tmdbRating, 7.5);
  assert.equal(result.imdbRating, 7.1);
  assert.equal(result.confidence, 0.82);
});

test('production cascade keeps native RT fields and suppresses low-confidence lookup fields', async () => {
  const overlay = loadOverlay({
    scripts: [{ props: { pageProps: { media: { id: 1, rtCriticsScore: 0 } } } }],
    sendMessage: async () => ({ success: true, data: { rtCriticsScore: 95, rtAudienceScore: 90, confidence: 0.69 } })
  });
  const result = await overlay.getRatings(1, 'Example', null, 'movie');
  assert.equal(result.rtCriticsScore, 0);
  assert.equal(result.rtAudienceScore, null);
  assert.equal(result.confidence, 1);
});

test('production native extractor does not assign page-level scores to unrelated grid cards', () => {
  const overlay = loadOverlay({ pathname: '/discover', scripts: [{ props: { pageProps: { media: { id: 1, rtCriticsScore: 99 } } } }] });
  assert.equal(overlay.extractSeerrNativeRatings(2), null);
  assert.equal(overlay.extractSeerrNativeRatings(1).rtCriticsScore, 99);
});

test('production cache coalesces calls, separates movie/TV IDs and retries rejection', async () => {
  const overlay = loadOverlay();
  let calls = 0;
  let release;
  overlay.setResolver(() => { calls++; return new Promise(resolve => { release = resolve; }); });
  const pending = Array.from({ length: 10 }, () => overlay.getRatings(1, 'Movie', null, 'movie'));
  assert.equal(calls, 1);
  release(overlay.Model.createRatingsBundle({ rtCriticsScore: 80, confidence: 1 }));
  await Promise.all(pending);
  overlay.setResolver(async () => { calls++; return overlay.Model.createRatingsBundle({ rtCriticsScore: 20, confidence: 1 }); });
  assert.equal((await overlay.getRatings(1, 'TV', null, 'tv')).rtCriticsScore, 20);
  assert.equal(calls, 2);
  overlay.setResolver(async () => { throw new Error('temporary failure'); });
  await assert.rejects(overlay.getRatings(2, 'Retry', null, 'movie'), /temporary failure/);
  overlay.setResolver(async () => overlay.Model.createRatingsBundle({ tmdbRating: 8 }));
  assert.equal((await overlay.getRatings(2, 'Retry', null, 'movie')).tmdbRating, 8);
});

test('production merge never upgrades confidence from an unrelated native score', () => {
  const { mergeBundles, Model } = loadOverlay();
  fc.assert(fc.property(fc.double({ min: 0.7, max: 0.999, noNaN: true }), confidence => {
    const native = Model.createRatingsBundle({ tmdbRating: 9, confidence: 1 });
    const rt = Model.createRatingsBundle({ rtCriticsScore: 80, confidence });
    assert.equal(mergeBundles(native, rt).confidence, confidence);
    assert.equal(mergeBundles(rt, native).confidence, confidence);
  }));
});

test('production detail rendering handles all 16 partial score combinations without duplication', async () => {
  for (let mask = 0; mask < 16; mask++) {
    const overlay = loadOverlay();
    const fields = ['rtCriticsScore', 'rtAudienceScore', 'imdbRating', 'tmdbRating'];
    const scores = [80, 85, 7.1, 7.5];
    const bundle = overlay.Model.createRatingsBundle({ confidence: 0.82, ...Object.fromEntries(fields.map((field, i) => [field, mask & (1 << i) ? scores[i] : null])) });
    overlay.setResolver(async () => bundle);
    overlay.injectDetailRatings();
    overlay.injectDetailRatings();
    await tick();
    const rows = overlay.container.children.filter(child => child.className === 'seerr-ratings-row');
    assert.equal(rows.length, mask ? 1 : 0, `combination ${mask}`);
    if (mask & 1) assert.match(rows[0].textContent, /~80%/);
    if (mask & 2) assert.match(rows[0].textContent, /~85%/);
  }
});

test('production detail rendering hides low-confidence RT and summary, preserving TMDB', async () => {
  const overlay = loadOverlay();
  overlay.setResolver(async () => overlay.Model.createRatingsBundle({ rtCriticsScore: 95, rtAudienceScore: 90, tmdbRating: 7, confidence: 0.69 }));
  overlay.injectDetailRatings();
  await tick();
  assert.doesNotMatch(overlay.container.textContent, /95%|90%|Critics love/);
  assert.match(overlay.container.textContent, /7\/10/);
});

test('production detail injection discards work completed after navigation', async () => {
  const overlay = loadOverlay();
  let release;
  overlay.setResolver(() => new Promise(resolve => { release = resolve; }));
  overlay.injectDetailRatings();
  overlay.context.window.location.pathname = '/movie/2';
  release(overlay.Model.createRatingsBundle({ rtCriticsScore: 90, confidence: 1 }));
  await tick();
  assert.equal(overlay.container.children.length, 1);
});

test('production overlay only recognizes the configured Seerr origin and path', async () => {
  for (const [url, expected] of [
    [undefined, false], ['invalid', false], ['https://other.example', false],
    ['http://seerr.example', false], ['https://seerr.example/private', false],
    ['https://seerr.example', true]
  ]) {
    const overlay = loadOverlay({ pathname: '/settings', settings: { seerrUrl: url } });
    await tick();
    assert.equal(overlay.isSeerrPage(), expected, String(url));
  }
});

test('production bulk eligibility allows unrated titles and rejects invalid media identities', () => {
  const { isRequestableTitle } = loadOverlay();
  assert.equal(isRequestableTitle({ tmdbId: '123', mediaType: 'movie', score: null }), true);
  assert.equal(isRequestableTitle({ tmdbId: '123', mediaType: 'tv', score: 0 }), true);
  for (const tmdbId of [null, undefined, '', 'unknown', '-1', '0']) {
    assert.equal(isRequestableTitle({ tmdbId, mediaType: 'movie', score: 100 }), false);
  }
  assert.equal(isRequestableTitle({ tmdbId: '123', mediaType: 'person' }), false);
});

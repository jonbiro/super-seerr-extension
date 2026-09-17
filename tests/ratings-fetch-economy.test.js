// resolveRatings runs once per card, so a 20-card grid multiplies whatever
// fetchSeerrSessionRatings does. It used to walk every endpoint even after the
// first one returned a complete bundle.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadOverlay } = require('./helpers/overlay');

const COMPLETE = { rtCriticsScore: 88, rtAudienceScore: 91, imdbRating: 8.2, tmdbRating: 7.9 };

const TMDB_ID = 550;

// Payloads are keyed by exact pathname: every endpoint URL for a title shares
// the /api/v1/movie/<id> prefix, so substring matching picks the wrong one.
function overlayWithSeerr(payloads) {
  const paths = [];
  const overlay = loadOverlay({
    settings: { seerrUrl: 'https://seerr.example' },
    fetch: async url => {
      const { pathname } = new URL(String(url));
      paths.push(pathname);
      const body = payloads[pathname];
      return body === undefined ? { ok: false, status: 404 } : { ok: true, json: async () => body };
    }
  });
  // The overlay also resolves its own detail route on load; ignore that traffic.
  return { overlay, callsForTitle: () => paths.filter(path => path.includes(`/${TMDB_ID}`)) };
}

const RATINGS_COMBINED = `/api/v1/movie/${TMDB_ID}/ratingscombined`;
const RATINGS = `/api/v1/movie/${TMDB_ID}/ratings`;
const DETAILS = `/api/v1/movie/${TMDB_ID}`;

test('a complete first response stops the remaining endpoint calls', async () => {
  const { overlay, callsForTitle } = overlayWithSeerr({ [RATINGS_COMBINED]: COMPLETE });
  const bundle = await overlay.fetchSeerrSessionRatings(TMDB_ID, 'movie');
  const urls = callsForTitle();

  assert.equal(bundle.rtCriticsScore, 88);
  assert.equal(bundle.tmdbRating, 7.9);
  assert.equal(urls.length, 1, `expected one call, saw ${urls.length}: ${urls.join(', ')}`);
});

test('a partial response still falls through to the later endpoints', async () => {
  const { overlay, callsForTitle } = overlayWithSeerr({
    [RATINGS_COMBINED]: { rtCriticsScore: 88 },
    [RATINGS]: { rtAudienceScore: 91 },
    [DETAILS]: { voteAverage: 7.9 }
  });
  const bundle = await overlay.fetchSeerrSessionRatings(TMDB_ID, 'movie');

  assert.equal(callsForTitle().length, 3, 'gaps must still be filled');
  assert.equal(bundle.rtCriticsScore, 88);
  assert.equal(bundle.rtAudienceScore, 91);
  assert.equal(bundle.tmdbRating, 7.9);
});

test('the earliest endpoint keeps precedence over later ones', async () => {
  const { overlay } = overlayWithSeerr({
    [RATINGS_COMBINED]: { rtCriticsScore: 88 },
    [RATINGS]: { rtCriticsScore: 11, rtAudienceScore: 91 }
  });
  const bundle = await overlay.fetchSeerrSessionRatings(TMDB_ID, 'movie');

  assert.equal(bundle.rtCriticsScore, 88, 'a later endpoint must not overwrite an earlier score');
});

test('completeness requires every score, not merely some', () => {
  const { overlay } = overlayWithSeerr({});
  assert.equal(overlay.isBundleComplete(overlay.mergeBundles(null, null)), false);
  assert.equal(overlay.isBundleComplete({ ...COMPLETE }), true);
  for (const field of Object.keys(COMPLETE)) {
    assert.equal(overlay.isBundleComplete({ ...COMPLETE, [field]: null }), false, `${field} missing means incomplete`);
  }
});

test('a 404 from the combined endpoint stops the cascade', async () => {
  // Seerr returns 404 from /ratingscombined only when both RT and IMDb are
  // missing, and from /ratings when RT is missing. So a combined 404
  // guarantees the next call 404s too: asking is pure console noise.
  const { overlay, callsForTitle } = overlayWithSeerr({ [DETAILS]: { voteAverage: 7.9 } });
  const bundle = await overlay.fetchSeerrSessionRatings(TMDB_ID, 'movie');

  const paths = callsForTitle();
  assert.ok(!paths.includes(RATINGS), `should not ask /ratings after a combined 404, saw ${paths.join(', ')}`);
  assert.ok(paths.includes(DETAILS), 'the detail endpoint is still worth asking');
  assert.equal(bundle.tmdbRating, 7.9);
});

test('a combined response that succeeds still allows the other endpoints', async () => {
  const { overlay, callsForTitle } = overlayWithSeerr({
    [RATINGS_COMBINED]: { rtCriticsScore: 88 },
    [RATINGS]: { rtAudienceScore: 91 },
    [DETAILS]: { voteAverage: 7.9 }
  });
  await overlay.fetchSeerrSessionRatings(TMDB_ID, 'movie');
  assert.equal(callsForTitle().length, 3, 'a successful combined response does not short-circuit anything');
});

test('a TV lookup is unaffected, having no combined endpoint', async () => {
  const { overlay, callsForTitle } = overlayWithSeerr({});
  await overlay.fetchSeerrSessionRatings(TMDB_ID, 'tv');
  const paths = callsForTitle();
  assert.ok(paths.some(path => path.endsWith('/ratings')), 'tv still asks for its ratings');
});

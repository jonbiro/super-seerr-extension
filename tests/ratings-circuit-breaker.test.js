// Missing scores are title-specific, never proof that another title or media
// type cannot be rated. Exercise actual endpoint selection and legacy storage.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadOverlay } = require('./helpers/overlay');

function fixture(local = {}) {
  const paths = [];
  const overlay = loadOverlay({
    settings: { seerrUrl: 'https://seerr.example/' }, local,
    fetch: async url => {
      const path = new URL(String(url)).pathname;
      paths.push(path);
      if (path.includes('/9999/') && path.includes('/ratings')) {
        return { ok: true, json: async () => ({ criticsScore: 95, imdb: { criticsScore: 8.2 } }) };
      }
      if (path.includes('/ratings')) return { ok: false, status: 404 };
      return { ok: true, json: async () => ({ voteAverage: 7.9 }) };
    }
  });
  return { overlay, paths };
}

for (const missingType of ['movie', 'tv']) {
  for (const ratedType of ['movie', 'tv']) {
    test(`${missingType} misses do not suppress a rated ${ratedType}`, async () => {
      const { overlay, paths } = fixture();
      for (let i = 0; i < 20; i++) {
        await overlay.fetchSeerrSessionRatings(1000 + i, missingType);
      }
      const bundle = await overlay.fetchSeerrSessionRatings(9999, ratedType);
      assert.ok(paths.includes(`/api/v1/${ratedType}/9999/${ratedType === 'movie' ? 'ratingscombined' : 'ratings'}`));
      assert.equal(bundle.rtCriticsScore, 95);
    });
  }
}

test('legacy persisted server verdict cannot silence working ratings', async () => {
  const { overlay, paths } = fixture({ seerrRatingsUnavailableV1: {
    server: 'https://seerr.example/', kinds: { ratingscombined: Date.now(), ratings: Date.now() }
  } });
  await overlay.getRatings(9999, 'Rated title', null, 'movie');
  assert.ok(paths.includes('/api/v1/movie/9999/ratingscombined'));
  assert.equal(overlay.localStore.seerrRatingsUnavailableV1, undefined);
});

test('combined missing ratings skip only the redundant request for that title', async () => {
  const { overlay, paths } = fixture();
  const bundle = await overlay.fetchSeerrSessionRatings(8000, 'movie');
  assert.ok(paths.includes('/api/v1/movie/8000/ratingscombined'));
  assert.ok(!paths.includes('/api/v1/movie/8000/ratings'));
  assert.equal(bundle.tmdbRating, 7.9);
});

test('diagnostics count actual endpoint attempts', async () => {
  const { overlay, paths } = fixture();
  await overlay.fetchSeerrSessionRatings(8000, 'movie');
  await overlay.fetchSeerrSessionRatings(9999, 'tv');
  const counts = overlay.context.window.seerr_debug.ratings.diagnose().seerrRatings.requestsMade;
  for (const kind of ['ratings', 'ratingscombined']) {
    assert.equal(counts[kind], paths.filter(path => path.endsWith(`/${kind}`)).length);
  }
});

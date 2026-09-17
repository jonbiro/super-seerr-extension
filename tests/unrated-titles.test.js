// TMDB and IMDb report 0 for a title nobody has rated, which is not the same
// as a title rated zero. Rendering "0/10" tells the viewer the film is
// terrible when it means there is no score yet, and sorts it below real 1/10s.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadOverlay } = require('./helpers/overlay');

const settings = { seerrUrl: 'https://seerr.example/' };
const bundleFor = (overlay, obj) => overlay.bundleFromRatingObject(obj, 'test');

test('a TMDB rating of zero is treated as no rating', () => {
  const overlay = loadOverlay({ settings });
  assert.equal(bundleFor(overlay, { voteAverage: 0 }), null, 'nothing to show for an unrated title');
  assert.equal(bundleFor(overlay, { tmdbRating: 0 }), null);
});

test('an IMDb rating of zero is treated as no rating', () => {
  const overlay = loadOverlay({ settings });
  // IMDb's scale starts at 1, so a zero is an absent rating.
  assert.equal(bundleFor(overlay, { imdbRating: 0 }), null);
});

test('a real ten-point score is unaffected, however low', () => {
  const overlay = loadOverlay({ settings });
  assert.equal(bundleFor(overlay, { voteAverage: 0.1 }).tmdbRating, 0.1);
  assert.equal(bundleFor(overlay, { voteAverage: 1 }).tmdbRating, 1);
  assert.equal(bundleFor(overlay, { imdbRating: 2.3 }).imdbRating, 2.3);
});

test('a Rotten Tomatoes zero still counts, because 0% is a real verdict', () => {
  const overlay = loadOverlay({ settings });
  assert.equal(bundleFor(overlay, { rtCriticsScore: 0 }).rtCriticsScore, 0);
  assert.equal(bundleFor(overlay, { rtAudienceScore: 0 }).rtAudienceScore, 0);
});

test('an unrated title falls through to whatever else is known', () => {
  const overlay = loadOverlay({ settings });
  const bundle = bundleFor(overlay, { voteAverage: 0, rtCriticsScore: 71 });
  assert.equal(bundle.rtCriticsScore, 71);
  assert.equal(bundle.tmdbRating, null, 'the empty TMDB score must not ride along');
});

test('an unrated title is not sorted as though it scored zero', () => {
  const overlay = loadOverlay({ settings });
  const card = (id, tmdbRating) => ({
    id, style: {}, attributes: {},
    __seerrRatings: { rtCriticsScore: null, rtAudienceScore: null, imdbRating: null, tmdbRating, confidence: 1 },
    closest: () => null, hasAttribute(n) { return n in this.attributes; },
    getAttribute(n) { return this.attributes[n]; }, setAttribute(n, v) { this.attributes[n] = v; },
    querySelector: () => null
  });
  const grid = {
    cards: [card(0, null), card(1, 1.2), card(2, 8.4)],
    querySelectorAll: s => s === '[data-testid="title-card"]' ? grid.cards.slice() : [],
    appendChild(c) { grid.cards.splice(grid.cards.indexOf(c), 1); grid.cards.push(c); }
  };
  grid.cards.forEach(c => { c.parentElement = grid; });

  overlay.applyScoreSort(grid, 'tmdb-asc');
  assert.deepEqual(grid.cards.map(c => c.id), [1, 2, 0], 'the unrated title sorts last, not first');
});

// imdbRating was fetched into every bundle and shown on detail pages, but was
// the one score the grid controls could neither sort nor filter by.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadOverlay } = require('./helpers/overlay');

// Cards carry a resolved bundle, which is how the overlay reads IMDb: there is
// no IMDb card badge to parse back out of the DOM.
function makeGrid(bundles) {
  const grid = {
    cards: [], mutations: 0,
    querySelectorAll(selector) { return selector === '[data-testid="title-card"]' ? this.cards.slice() : []; },
    appendChild(card) {
      this.cards.splice(this.cards.indexOf(card), 1);
      this.cards.push(card);
      this.mutations++;
    }
  };
  grid.cards = bundles.map((bundle, index) => ({
    id: index, style: {}, attributes: {}, parentElement: grid,
    __seerrRatings: bundle === null ? undefined : {
      rtCriticsScore: null, rtAudienceScore: null, imdbRating: null, tmdbRating: null,
      confidence: 1, ...bundle
    },
    closest() { return null; },
    hasAttribute(name) { return name in this.attributes; },
    getAttribute(name) { return this.attributes[name]; },
    setAttribute(name, value) { this.attributes[name] = value; },
    querySelector() { return null; }
  }));
  return grid;
}
const ids = grid => grid.cards.map(card => card.id);
const visible = grid => grid.cards.filter(card => card.style.display !== 'none').map(card => card.id);

test('IMDb sorts in both directions and keeps unrated titles last', () => {
  const overlay = loadOverlay();
  const grid = makeGrid([
    { imdbRating: 7.5 }, null, { imdbRating: 9.1 }, { imdbRating: 0 }, { imdbRating: 7.5 }, null
  ]);

  overlay.applyScoreSort(grid, 'imdb-desc');
  assert.deepEqual(ids(grid), [2, 0, 4, 3, 1, 5], 'highest first, ties in original order, unrated last');

  overlay.applyScoreSort(grid, 'imdb-asc');
  assert.deepEqual(ids(grid), [3, 0, 4, 2, 1, 5], 'lowest first, zero is a real score, unrated still last');
});

test('the IMDb filter hides titles below the minimum, and unrated titles', () => {
  const overlay = loadOverlay();
  const grid = makeGrid([{ imdbRating: 8.2 }, { imdbRating: 5.0 }, null, { imdbRating: 0 }]);

  overlay.applyScoreFilters(grid, { minCritics: 0, minAudience: 0, minTmdb: 0, minImdb: 7 });
  assert.deepEqual(visible(grid), [0], 'only titles at or above the minimum remain');

  overlay.applyScoreFilters(grid, { minCritics: 0, minAudience: 0, minTmdb: 0, minImdb: 0 });
  assert.deepEqual(visible(grid).sort((a, b) => a - b), [0, 1, 2, 3], 'a zero minimum filters nothing');
});

test('the IMDb filter combines with the others rather than replacing them', () => {
  const overlay = loadOverlay();
  const grid = makeGrid([
    { imdbRating: 8.5, rtCriticsScore: 90 },
    { imdbRating: 8.5, rtCriticsScore: 40 },
    { imdbRating: 4.0, rtCriticsScore: 90 }
  ]);

  overlay.applyScoreFilters(grid, { minCritics: 80, minAudience: 0, minTmdb: 0, minImdb: 7 });
  assert.deepEqual(visible(grid), [0], 'a title must clear every active minimum');
});

test('a low-confidence RT match does not suppress the IMDb score', () => {
  const overlay = loadOverlay();
  // Confidence gates RT fields only; IMDb comes from Seerr, not title matching.
  const grid = makeGrid([{ imdbRating: 8.0, rtCriticsScore: 95, confidence: 0.2 }, { imdbRating: 6.0 }]);

  overlay.applyScoreSort(grid, 'imdb-desc');
  assert.deepEqual(ids(grid), [0, 1]);
  overlay.applyScoreFilters(grid, { minCritics: 0, minAudience: 0, minTmdb: 0, minImdb: 7 });
  assert.deepEqual(visible(grid), [0]);
});

test('Best Score falls through to IMDb when no other score is present', () => {
  const overlay = loadOverlay();
  // Previously an IMDb-only card sorted as unrated under the combined sort.
  const grid = makeGrid([{ imdbRating: 9.0 }, { tmdbRating: 5.0 }, null]);

  overlay.applyScoreSort(grid, 'score-desc');
  assert.deepEqual(ids(grid), [0, 1, 2], 'IMDb 9.0 outranks TMDB 5.0; the unrated card stays last');
});

test('Best Score still prefers RT over IMDb', () => {
  const overlay = loadOverlay();
  const grid = makeGrid([{ imdbRating: 9.5 }, { rtCriticsScore: 99 }]);

  overlay.applyScoreSort(grid, 'score-desc');
  assert.deepEqual(ids(grid), [1, 0], 'RT critics remains the first choice');
});

test('the controls offer IMDb sorting and an IMDb minimum', () => {
  const source = require('node:fs').readFileSync('src/content/seerr-integration.js', 'utf8');
  for (const needle of ['imdb-desc', 'imdb-asc', 'seerr-min-imdb', 'minImdb']) {
    assert.ok(source.includes(needle), `controls should wire up ${needle}`);
  }
  // Reset must clear the new input like the others.
  const reset = source.slice(source.indexOf("currentSort = 'default';"));
  assert.ok(/seerr-min-imdb'\)\.value = '0'/.test(reset), 'Reset should clear the IMDb minimum');
  assert.ok(/currentFilters\.minImdb = 0/.test(reset), 'Reset should clear the stored IMDb minimum');
});

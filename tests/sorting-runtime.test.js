const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadOverlay } = require('./helpers/overlay');

function makeGrid(scores) {
  const grid = {
    cards: [], mutations: 0,
    querySelectorAll(selector) { return selector === '[data-testid="title-card"]' ? this.cards.slice() : []; },
    appendChild(card) {
      this.cards.splice(this.cards.indexOf(card), 1);
      this.cards.push(card);
      this.mutations++;
    }
  };
  grid.cards = scores.map(([critics, audience], index) => ({
    id: index, critics, audience, style: {}, attributes: {}, parentElement: grid,
    closest() { return null; },
    hasAttribute(name) { return name in this.attributes; },
    getAttribute(name) { return this.attributes[name]; },
    setAttribute(name, value) { this.attributes[name] = value; },
    querySelector(selector) {
      if (selector === '.seerr-card-audience-badge') return this.audience === null ? null : { textContent: `🍿 ~${this.audience}%` };
      if (selector === '.seerr-card-badge') return this.critics === null ? null : { textContent: `🍅 ~${this.critics}%` };
      return null;
    }
  }));
  return grid;
}
const ids = grid => grid.cards.map(card => card.id);

test('RT sorting handles both directions, audience, zero, ties and unrated cards', () => {
  const overlay = loadOverlay();
  const grid = makeGrid([[80, 20], [null, null], [0, 95], [90, 80], [80, 50], [null, null]]);
  overlay.applyScoreSort(grid, 'rt-critics-desc');
  assert.deepEqual(ids(grid), [3, 0, 4, 2, 1, 5]);
  overlay.applyScoreSort(grid, 'rt-critics-asc');
  assert.deepEqual(ids(grid), [2, 0, 4, 3, 1, 5]);
  overlay.applyScoreSort(grid, 'rt-audience-desc');
  assert.deepEqual(ids(grid), [2, 3, 4, 0, 1, 5]);
  overlay.applyScoreSort(grid, 'default');
  assert.deepEqual(ids(grid), [0, 1, 2, 3, 4, 5]);
});

test('active RT sort reapplies when ratings arrive or infinite scrolling adds cards', () => {
  const overlay = loadOverlay();
  const grid = makeGrid([[50, null], [null, null]]);
  overlay.setSort('rt-critics-desc');
  overlay.applyScoreFilters(grid);
  grid.cards[1].critics = 90;
  overlay.applyScoreFilters(grid);
  assert.deepEqual(ids(grid), [1, 0]);
  const added = makeGrid([[75, null]]).cards[0];
  added.id = 2;
  grid.cards.push(added);
  overlay.applyScoreSort(grid);
  assert.deepEqual(ids(grid), [1, 2, 0]);
});

test('unchanged sorting performs no DOM moves to avoid observer loops', () => {
  const overlay = loadOverlay();
  const grid = makeGrid([[30, null], [90, null], [null, null]]);
  overlay.applyScoreSort(grid, 'rt-critics-desc');
  grid.mutations = 0;
  overlay.applyScoreSort(grid, 'rt-critics-desc');
  assert.equal(grid.mutations, 0);
});

test('filter changes keep visible cards sorted and clearing filters restores ranked order', () => {
  const overlay = loadOverlay();
  const grid = makeGrid([[80, 30], [90, 90], [95, 20]]);
  overlay.setSort('rt-critics-desc');
  overlay.applyScoreFilters(grid, { minCritics: 0, minAudience: 50, minTmdb: 0 });
  assert.deepEqual(ids(grid), [1, 0, 2]);
  overlay.applyScoreFilters(grid, { minCritics: 0, minAudience: 0, minTmdb: 0 });
  assert.deepEqual(ids(grid), [2, 1, 0]);
});

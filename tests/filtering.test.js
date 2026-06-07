const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const seerrIntegration = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'content', 'seerr-integration.js'),
  'utf-8'
);

test('Seerr list filtering operates on media cards, not overlay badge elements', () => {
  assert.ok(
    seerrIntegration.includes('function getMediaCards(root = document)'),
    'Seerr integration should centralize media-card discovery'
  );
  assert.ok(
    seerrIntegration.includes("MEDIA_LINK_RE.test(link.getAttribute('href') || '')"),
    'Media-card discovery should be based on movie/TV links'
  );
  assert.ok(
    seerrIntegration.includes("!link.closest('[data-seerr-overlay=\"true\"]')"),
    'Media-card discovery should ignore extension overlay elements'
  );
  assert.ok(
    seerrIntegration.includes('const currentCards = getMediaCards(grid);'),
    'Filtering should refresh the current media-card list from the grid'
  );
});

test('Seerr list sorting and reset do not use broad class contains card selectors', () => {
  assert.ok(
    seerrIntegration.includes('const sorted = currentCards.sort((a, b) => {'),
    'Sorting should operate on the current media-card list'
  );
  assert.ok(
    seerrIntegration.includes('const allCards = getMediaCards(grid);'),
    'Reset should operate on media cards only'
  );
  assert.ok(
    !seerrIntegration.includes("grid.querySelectorAll('[class*=\"card\""),
    'Grid operations must not treat .seerr-card-badge as a card'
  );
});

test('Bulk selection tracks card elements so sorting/filtering cannot change selection identity', () => {
  assert.ok(
    seerrIntegration.includes('selectedCards.has(card)'),
    'Bulk selection should test selected card elements directly'
  );
  assert.ok(
    seerrIntegration.includes('selectedCards.add(card)'),
    'Bulk selection should store card elements directly'
  );
  assert.ok(
    !seerrIntegration.includes('selectedCards.add(cardIdx)'),
    'Bulk selection should not store mutable list indexes'
  );
});

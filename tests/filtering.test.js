const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadOverlay } = require('./helpers/overlay');

const seerrIntegration = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'content', 'seerr-integration.js'),
  'utf-8'
);
const background = require('./helpers/worker').workerSource();
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.base.json'), 'utf-8'));

test('Seerr list filtering operates on media cards, not overlay badge elements', () => {
  assert.ok(
    seerrIntegration.includes('function getMediaCards(root = document)'),
    'Seerr integration should centralize media-card discovery'
  );
  assert.ok(
    seerrIntegration.includes('[data-testid="title-card"]'),
    'Media-card discovery should use Seerr title-card wrappers, not hover-only links'
  );
  assert.ok(
    seerrIntegration.includes("mediaLinkTarget(link.getAttribute('href'))"),
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

test('Seerr list filtering hydrates card IDs from list API titles when links are absent', () => {
  assert.ok(
    seerrIntegration.includes('function hydrateCardsFromListItems'),
    'Content script should match list API titles to rendered title cards'
  );
  assert.ok(
    seerrIntegration.includes('card.__seerrListMediaInfo = info'),
    'Hydrated media info should be stored on the card'
  );
  assert.ok(
    seerrIntegration.includes('indexCurrentListRatings().then(() => injectCardBadges())'),
    'Badge injection should rerun after list API data is indexed'
  );
});

test('Seerr list filtering supports TMDB score fallback when RT is unavailable', () => {
  assert.ok(
    seerrIntegration.includes('seerr-card-tmdb-badge'),
    'Cards should render a TMDB fallback badge'
  );
  assert.ok(
    seerrIntegration.includes('/api/v1/discover/movies'),
    'Discover movie list data should be indexed for fallback scores'
  );
  assert.ok(
    seerrIntegration.includes('/api/v1/discover/tv'),
    'Discover TV list data should be indexed for fallback scores'
  );
  assert.ok(
    seerrIntegration.includes('class="seerr-min-tmdb"'),
    'Filter controls should expose a TMDB threshold'
  );
  assert.ok(
    seerrIntegration.includes('function getCardAnyScore(card)'),
    'Coverage and best-score sorting should include fallback score types'
  );
  assert.ok(
    seerrIntegration.includes('seerr-score-coverage'),
    'Filter controls should render visibly before score coverage is complete'
  );
  assert.ok(
    !seerrIntegration.includes('if (rated === 0) return;'),
    'Filter controls should not stay hidden just because ratings are still loading'
  );
});

test('Seerr ratings use background RT lookups with native and list data preferred', () => {
  assert.ok(
    seerrIntegration.includes("action: 'getRottenTomatoesRatings'"),
    'Content script should ask the background worker for RT ratings'
  );
  assert.ok(
    seerrIntegration.indexOf('const pageBundle = tmdbId') <
      seerrIntegration.indexOf('const rtBundle = await fetchRottenTomatoesRatings'),
    'Native and list ratings should be retained when filling missing RT fields'
  );
});

test('Background worker can resolve Rotten Tomatoes scores without Seerr API config', () => {
  assert.ok(
    background.includes("case 'getRottenTomatoesRatings'"),
    'Background message handler should expose RT lookup action'
  );
  assert.ok(
    background.includes('parseRtSearchResults'),
    'Background worker should parse RT search result rows'
  );
  assert.ok(
    background.includes('media-scorecard-json'),
    'Background worker should parse RT scorecard JSON for audience scores'
  );
  assert.ok(
    !background.includes('Server URL and API key must be configured') ||
      background.indexOf('async getRottenTomatoesRatings') < background.indexOf('async debugAPI'),
    'RT lookup should be independent from Seerr API request helpers'
  );
});

test('Seerr list sorting and reset do not use broad class contains card selectors', () => {
  assert.ok(
    seerrIntegration.includes('const visible = currentCards.filter(c => c.style.display !== \'none\')'),
    'Sorting should separate visible from filtered cards'
  );
  assert.ok(
    seerrIntegration.includes('const allCards = getMediaCards(grid);'),
    'Reset should operate on media cards only'
  );
  assert.ok(
    !seerrIntegration.includes("grid.querySelectorAll('[class*=\"card\""),
    'Grid operations must not treat .seerr-card-badge as a card'
  );
  assert.ok(
    seerrIntegration.includes('insertControlsBeforeGrid(bar, grid)'),
    'Controls should be inserted before the poster grid, not as a grid item'
  );
  assert.ok(
    seerrIntegration.includes('function applyScoreFilters'),
    'Filtering should use shared state so late-arriving ratings respect active thresholds'
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

test('Seerr overlay is registered dynamically and does not double-load shared UIComponents', () => {
  // The overlay must not be a static match: the Seerr origin is only known at
  // runtime, so a manifest entry would mean running on every site again.
  assert.ok(
    !manifest.content_scripts.some(entry => (entry.js || []).includes('src/content/seerr-integration.js')),
    'Overlay must not be a static content_scripts entry'
  );
  assert.ok(
    !manifest.content_scripts.some(entry => entry.matches.some(pattern => /^https?:\/\/\*\/\*$/.test(pattern))),
    'No content script may match every site'
  );

  const worker = fs.readFileSync('src/background/background.js', 'utf8');
  const declared = worker.match(/const OVERLAY_SCRIPT_FILES = \{([\s\S]*?)\n\};/);
  assert.ok(declared, 'Worker should declare the overlay files it registers');
  const files = [...declared[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
  assert.ok(files.includes('src/content/seerr-integration.js'), 'Overlay script should be registered');
  assert.ok(
    !files.includes('src/shared/UIComponents.js'),
    'Overlay registration must not redeclare UIComponents alongside the site integrations'
  );
});

test('only links back into this Seerr count as media cards', () => {
  const { mediaLinkTarget } = loadOverlay({ pathname: '/movie/1241982' });

  // Spread into this realm: an object built inside the VM fails deepStrictEqual
  // on its prototype alone, which says nothing about the values.
  assert.deepStrictEqual({ ...mediaLinkTarget('/movie/1241982') }, { mediaType: 'movie', tmdbId: '1241982' });
  assert.deepStrictEqual({ ...mediaLinkTarget('https://seerr.example/tv/99') }, { mediaType: 'tv', tmdbId: '99' });
  assert.deepStrictEqual({ ...mediaLinkTarget('https://seerr.example/tv/99/manage') }, { mediaType: 'tv', tmdbId: '99' });

  // A detail page links out to the same title on TMDB, whose canonical URL uses
  // the same path shape Seerr does. Matching the raw href put a rating badge on
  // the TMDB logo in the external-links row.
  assert.strictEqual(mediaLinkTarget('https://www.themoviedb.org/movie/1241982'), null);
  assert.strictEqual(mediaLinkTarget('https://letterboxd.com/tmdb/movie/1241982'), null);

  // Other same-origin routes are not titles, and neither is a junk href.
  assert.strictEqual(mediaLinkTarget('/collection/12'), null);
  assert.strictEqual(mediaLinkTarget('/discover/movies'), null);
  assert.strictEqual(mediaLinkTarget('javascript:void(0)'), null);
  assert.strictEqual(mediaLinkTarget(''), null);
  assert.strictEqual(mediaLinkTarget(null), null);
});

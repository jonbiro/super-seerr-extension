// Cold loads must still badge cards: the title index Seerr already fetched
// persists next to the scores, and pending writes flush on unload instead of
// dying with the page. These drive the real overlay in jsdom the way
// dom-integration.test.js does, with linkless poster-only cards — the shape
// Seerr renders before anything is hovered.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Config = require('../src/shared/RatingsConfig');

const CACHE_KEY = 'overlayRatingsV1';
const SERVER = 'https://seerr.example/';
const BUNDLE = {
  rtCriticsScore: 90, rtAudienceScore: 80, tmdbRating: 7.5, imdbRating: 7,
  confidence: 1, source: 'seerr-native', lastUpdated: Date.now()
};
const INDEX_ENTRY = {
  tmdbId: '123', mediaType: 'movie', title: 'Dune', originalTitle: '',
  year: 2021, posterPath: '/p123.jpg', releaseDate: '2021-10-22'
};
const CARDS = `<article data-testid="title-card"><div><img src="https://image.tmdb.org/t/p/w300/p123.jpg" alt=""></div></article>
  <article data-testid="title-card"><div><img src="https://image.tmdb.org/t/p/w300/unknown.jpg" alt=""></div></article>`;

function openGrid({ local = {}, plexConfigured = false, rtScores = null, serverUrl = 'https://seerr.example', apiConfigured = false,
  configForPage = null, deferCache = false, pageUrl = 'https://seerr.example/discover', detail = false } = {}) {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(`<main>${detail ? '<section class="media-header"><h1>Dune (2021)</h1></section>' : ''}<div id="grid">${CARDS}</div></main>`,
    { url: pageUrl, runScripts: 'outside-only' });
  const { window } = dom;
  const localStore = { ...local };
  const syncStore = { ...(serverUrl ? { seerrUrl: serverUrl } : {}) };
  let changeListener = null;
  let messageListener = null;
  const messages = [];
  window.chrome = {
    storage: {
      sync: {
        get: async () => ({ ...syncStore }),
        set: async value => { Object.assign(syncStore, value); }
      },
      local: {
        get: async keys => Object.fromEntries(
          (Array.isArray(keys) ? keys : [keys]).filter(key => localStore[key] !== undefined).map(key => [key, localStore[key]])),
        set: async value => { Object.assign(localStore, value); },
        remove: async keys => { (Array.isArray(keys) ? keys : [keys]).forEach(key => { delete localStore[key]; }); }
      },
      onChanged: { addListener(fn) { changeListener = fn; } }
    },
    runtime: { onMessage: { addListener: fn => { messageListener = fn; } }, sendMessage: async message => {
      messages.push(message);
      if (message.action === 'getConfigState') {
        return { success: true, data: configForPage ? await configForPage(window.location) : { apiConfigured, serverUrl: syncStore.seerrUrl || null, plexConfigured } };
      }
      if (message.action === 'getRottenTomatoesRatings') return { success: true, data: rtScores };
      if (message.action === 'plexAddToWatchlist') return { success: true, data: { ratingKey: 'rk', already: false } };
      return { success: true, data: null };
    } }
  };
  window.fetch = async () => ({ ok: true, json: async () => ({ results: [] }) });
  for (const file of ['RatingsModel', 'RatingsConfig']) {
    window.eval(fs.readFileSync(`src/shared/${file}.js`, 'utf8'));
  }
  let releaseCache;
  const cacheGate = deferCache ? new Promise(resolve => { releaseCache = resolve; }) : null;
  const cacheMessage = require('./helpers/cache-bridge').cacheBridge({ settings: () => window.chrome.storage.sync.get(), local: window.chrome.storage.local, url: window.location.href });
  const send = window.chrome.runtime.sendMessage;
  window.chrome.runtime.sendMessage = async message => {
    if (message.action === 'getOverlayCache' && cacheGate) await cacheGate;
    return ['getOverlayCache', 'putOverlayCache'].includes(message.action) ? cacheMessage(message) : send(message);
  };
  require('./helpers/overlay-modules').loadOverlayModules(window);
  window.eval(fs.readFileSync('src/content/seerr-integration.js', 'utf8').replace(/\}\)\(\);\s*$/, `window.testOverlay = {
    injectCardBadges, injectPlexCardButtons, injectSortFilterControls, hydrateCardsFromListItems, getRatings,
    flushPersistedRatings, projectListIndex, detectRoute, handleObservedApiResponse, handleRouteChange,
    toggleBulkMode, notifyResult, restoreListIndex, rememberListItems, listItemCount: () => lastListItems.length
  }; })();`));
  return {
    dom, window, messages, localStore, releaseCache,
    notify: message => messageListener?.(message),
    saveServerUrl: url => {
      syncStore.seerrUrl = url;
      return changeListener?.({ seerrUrl: { newValue: url } }, 'sync');
    }
  };
}

const flush = async (window, rounds = 40) => {
  for (let i = 0; i < rounds; i++) await new Promise(resolve => setImmediate(resolve));
};

for (const url of ['https://other.example/api/v1/discover/movies', '/nested/api/v1/discover/movies',
  '/api/v1/auth/me', '/api/v1/settings/discover', 'https://user:secret@seerr.example/api/v1/discover/movies', 'not a URL']) {
  test(`observations from ${url} cannot seed this server's catalogue or scores`, async t => {
    const fixture = openGrid();
    t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.dom.window.close(); });
    await flush(fixture.window);
    fixture.window.testOverlay.handleObservedApiResponse({ source: fixture.window, origin: fixture.window.location.origin,
      data: { channel: 'super-seerr:api', url, items: [{ id: 123, mediaType: 'movie', title: 'Wrong server', posterPath: '/p123.jpg', rtCriticsScore: 99 }] } });
    await flush(fixture.window);
    assert.equal(fixture.window.testOverlay.listItemCount(), 0);
    assert.equal(fixture.window.document.querySelectorAll('.seerr-card-badge').length, 0);
    await fixture.window.testOverlay.flushPersistedRatings();
    assert.equal(Object.keys(fixture.localStore.overlayRatingsByServerV1?.['https://seerr.example']?.entries || {}).length, 0);
  });
}

test('a base-path site accepts its own title API and rejects the parent installation', async t => {
  const fixture = openGrid({ serverUrl: 'https://seerr.example/base', pageUrl: 'https://seerr.example/base/discover' });
  t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.dom.window.close(); });
  await flush(fixture.window);
  const observe = url => fixture.window.testOverlay.handleObservedApiResponse({ source: fixture.window, origin: fixture.window.location.origin,
    data: { channel: 'super-seerr:api', url, items: [{ id: 123, mediaType: 'movie', title: 'Dune', posterPath: '/p123.jpg', ...BUNDLE }] } });
  observe('/api/v1/discover/movies');
  assert.equal(fixture.window.testOverlay.listItemCount(), 0);
  observe('/base/api/v1/discover/movies?page=1');
  assert.equal(fixture.window.testOverlay.listItemCount(), 1);
  const bundle = await fixture.window.testOverlay.getRatings(123, 'Dune', 2021, 'movie');
  assert.equal(bundle.rtCriticsScore, 90); assert.equal(bundle.imdbRating, 7);
  await fixture.window.testOverlay.flushPersistedRatings();
  assert.equal(fixture.localStore.overlayRatingsByServerV1['https://seerr.example/base'].entries['movie:123'].bundle.rtCriticsScore, 90);
  assert.equal(fixture.localStore.overlayRatingsByServerV1['https://seerr.example/base'].index[0].tmdbId, '123');
  const reloaded = openGrid({ local: fixture.localStore, serverUrl: 'https://seerr.example/base', pageUrl: 'https://seerr.example/base/discover' });
  t.after(() => { reloaded.window.dispatchEvent(new reloaded.window.Event('pagehide')); reloaded.dom.window.close(); });
  await flush(reloaded.window);
  assert.equal(reloaded.window.document.querySelectorAll('.seerr-card-badge').length, 2);
  assert.equal(reloaded.messages.filter(message => message.action === 'getRottenTomatoesRatings').length, 0);
});

test('SPA navigation into an inactive nested site removes the parent overlay and returning restores it', async t => {
  const fixture = openGrid({ local: seedBlob({ entries: { 'movie:123': { bundle: BUNDLE, cachedAt: Date.now() } } }),
    configForPage: location => ({ apiConfigured: false,
      serverUrl: location.pathname.startsWith('/nested/') ? null : 'https://seerr.example' }) });
  t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.dom.window.close(); });
  await flush(fixture.window);
  assert.equal(fixture.window.document.querySelectorAll('.seerr-card-badge').length, 2);
  fixture.window.history.pushState({}, '', '/nested/discover');
  fixture.window.testOverlay.handleRouteChange(); await flush(fixture.window);
  assert.equal(fixture.window.document.querySelectorAll('[data-seerr-overlay=true]').length, 0);
  fixture.window.history.pushState({}, '', '/discover');
  fixture.window.testOverlay.handleRouteChange(); await flush(fixture.window);
  assert.equal(fixture.window.document.querySelectorAll('.seerr-card-badge').length, 2);
});

test('same-server SPA navigation preserves identities for linkless cards', async t => {
  const fixture = openGrid({ local: seedBlob({ entries: { 'movie:123': { bundle: BUNDLE, cachedAt: Date.now() } } }) });
  t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.dom.window.close(); });
  await flush(fixture.window);
  fixture.window.history.pushState({}, '', '/search?query=Dune');
  fixture.window.testOverlay.handleRouteChange(); await flush(fixture.window);
  assert.equal(fixture.window.document.querySelectorAll('.seerr-card-badge').length, 2);
});

test('a retained TV catalogue identity does not become a movie after SPA navigation', async t => {
  const fixture = openGrid({ pageUrl: 'https://seerr.example/discover/tv' });
  t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.dom.window.close(); });
  await flush(fixture.window);
  fixture.window.testOverlay.handleObservedApiResponse({ source: fixture.window, origin: fixture.window.location.origin,
    data: { channel: 'super-seerr:api', url: '/api/v1/discover/tv',
      items: [{ id: 123, title: 'Example Series', posterPath: '/p123.jpg', ...BUNDLE }] } });
  await fixture.window.testOverlay.getRatings(123, 'Example Series', null, 'tv');
  fixture.window.history.pushState({}, '', '/discover/movies');
  fixture.window.testOverlay.handleRouteChange(); await flush(fixture.window);
  await fixture.window.testOverlay.flushPersistedRatings();
  const cache = fixture.localStore.overlayRatingsByServerV1['https://seerr.example'];
  assert.equal(cache.index[0].mediaType, 'tv');
  assert.ok(cache.entries['tv:123']); assert.equal(cache.entries['movie:123'], undefined);
});

test('a slow inactive-site verdict cannot suppress the overlay after rapid SPA navigation back', async t => {
  let finish;
  const fixture = openGrid({ local: seedBlob({ entries: { 'movie:123': { bundle: BUNDLE, cachedAt: Date.now() } } }),
    configForPage: location => location.pathname.startsWith('/nested/') ? new Promise(resolve => { finish = resolve; })
      : { apiConfigured: false, serverUrl: 'https://seerr.example' } });
  t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.dom.window.close(); });
  await flush(fixture.window);
  fixture.window.history.pushState({}, '', '/nested/discover');
  fixture.window.testOverlay.handleRouteChange(); await flush(fixture.window);
  assert.equal(fixture.window.document.querySelectorAll('[data-seerr-overlay=true]').length, 0);
  fixture.window.history.pushState({}, '', '/discover');
  fixture.window.testOverlay.handleRouteChange(); await flush(fixture.window);
  assert.equal(fixture.window.document.querySelectorAll('.seerr-card-badge').length, 2);
  finish({ apiConfigured: false, serverUrl: null }); await flush(fixture.window);
  assert.equal(fixture.window.document.querySelectorAll('.seerr-card-badge').length, 2);
});

function seedBlob({ entries = {}, index = [INDEX_ENTRY], server = SERVER, matcher = Config.matcherVersion } = {}) {
  return { [CACHE_KEY]: { server, epoch: 0, matcher, entries, index } };
}

function recycledCardFixture() {
  return openGrid({ plexConfigured: true, apiConfigured: true, local: seedBlob({
    index: [INDEX_ENTRY, { tmdbId: '456', mediaType: 'movie', title: 'Arrival', year: 2016, posterPath: '/p456.jpg' }],
    entries: { 'movie:123': { bundle: BUNDLE, cachedAt: Date.now() },
      'movie:456': { bundle: { ...BUNDLE, rtCriticsScore: 95 }, cachedAt: Date.now() } }
  }) });
}

test('a reused poster-only card replaces its old badges and Plex action', async t => {
  const fixture = recycledCardFixture();
  t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.dom.window.close(); });
  await flush(fixture.window);
  const card = fixture.window.document.querySelector('[data-testid="title-card"]');
  assert.match(card.textContent, /90%/);
  card.querySelector('img').src = 'https://image.tmdb.org/t/p/w300/p456.jpg';
  fixture.window.testOverlay.injectCardBadges(); fixture.window.testOverlay.injectPlexCardButtons();
  await flush(fixture.window);
  assert.match(card.textContent, /95%/);
  assert.equal(card.querySelector('.seerr-plex-card-button').getAttribute('aria-label'), 'Add Arrival to Plex Watchlist');
  card.querySelector('.seerr-plex-card-button').click(); await flush(fixture.window);
  assert.equal(fixture.messages.find(message => message.action === 'plexAddToWatchlist').data.tmdbId, 456);
});

test('a stale Plex button cannot add the old title after an unknown poster replaces it', async t => {
  const fixture = recycledCardFixture();
  t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.dom.window.close(); });
  await flush(fixture.window);
  const card = fixture.window.document.querySelector('[data-testid="title-card"]');
  const oldButton = card.querySelector('.seerr-plex-card-button');
  card.querySelector('img').src = 'https://image.tmdb.org/t/p/w300/unobserved.jpg';
  // Deliberately click before the observer's debounced refresh runs.
  oldButton.click(); await flush(fixture.window);
  assert.equal(fixture.messages.filter(message => message.action === 'plexAddToWatchlist').length, 0);
  assert.equal(card.querySelectorAll('.seerr-card-badge, .seerr-rating-details, .seerr-plex-card-button').length, 0);
});

test('bulk review cannot substitute a recycled poster-only card for the selected title', async t => {
  const fixture = recycledCardFixture();
  t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.dom.window.close(); });
  await flush(fixture.window);
  const doc = fixture.window.document, card = doc.querySelector('[data-testid="title-card"]');
  fixture.window.testOverlay.toggleBulkMode(); card.querySelector('.seerr-select-checkbox').click();
  card.querySelector('img').src = 'https://image.tmdb.org/t/p/w300/p456.jpg';
  doc.querySelector('.seerr-bulk-review').click();
  assert.equal(doc.querySelector('.seerr-confirmation-modal'), null);
  assert.equal(doc.querySelector('.seerr-bulk-review').disabled, true);
  assert.match(doc.querySelector('.seerr-bulk-count').textContent, /0 selected/);
});

test('poster size and query changes preserve a card identity and its existing action', async t => {
  const fixture = recycledCardFixture();
  t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.dom.window.close(); });
  await flush(fixture.window);
  const card = fixture.window.document.querySelector('[data-testid="title-card"]');
  const button = card.querySelector('.seerr-plex-card-button');
  card.querySelector('img').src = 'https://image.tmdb.org/t/p/w600/p123.jpg?size=600';
  fixture.window.testOverlay.injectCardBadges(); fixture.window.testOverlay.injectPlexCardButtons();
  await flush(fixture.window);
  assert.equal(card.querySelector('.seerr-plex-card-button'), button);
  assert.match(card.textContent, /90%/);
});

for (const href of ['https://other.example/movie/123', 'https://www.imdb.com/title/tt1160419/'])
test(`a foreign link (${href}) cannot regain a cached card identity through its unchanged poster`, async t => {
  const fixture = recycledCardFixture();
  t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.dom.window.close(); });
  await flush(fixture.window);
  const card = fixture.window.document.querySelector('[data-testid="title-card"]');
  const link = fixture.window.document.createElement('a');
  link.href = href; link.textContent = 'Dune'; card.append(link);
  fixture.window.testOverlay.injectCardBadges(); fixture.window.testOverlay.injectPlexCardButtons();
  await flush(fixture.window);
  assert.equal(card.querySelectorAll('.seerr-card-badge, .seerr-plex-card-button').length, 0);
});

test('a stored title index identifies linkless cards with no network and no hover', async t => {
  const fixture = openGrid({ local: seedBlob(), plexConfigured: true });
  t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.dom.window.close(); });
  await flush(fixture.window);

  fixture.window.testOverlay.hydrateCardsFromListItems();
  fixture.window.testOverlay.injectPlexCardButtons();

  const buttons = fixture.window.document.querySelectorAll('.seerr-plex-card-button');
  assert.equal(buttons.length, 1, 'the indexed poster resolves; the unknown one stays unresolved');
  assert.equal(buttons[0].getAttribute('aria-label'), 'Add Dune to Plex Watchlist');
});

test('a stored score badges the card on a cold load', async t => {
  const fixture = openGrid({ local: seedBlob({ entries: { 'movie:123': { bundle: BUNDLE, cachedAt: Date.now() } } }) });
  t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.dom.window.close(); });
  await flush(fixture.window);

  fixture.window.testOverlay.hydrateCardsFromListItems();
  fixture.window.testOverlay.injectCardBadges();
  for (let i = 0; i < 40; i++) await new Promise(resolve => setImmediate(resolve));

  const cards = fixture.window.document.querySelectorAll('[data-testid="title-card"]');
  assert.equal(cards[0].querySelectorAll('.seerr-card-badge').length, 2, 'critics plus audience badges');
  assert.match(cards[0].textContent, /90%/);
  assert.equal(cards[1].querySelectorAll('.seerr-card-badge').length, 0, 'the unknown poster stays unresolved');
  const rtLookups = fixture.messages.filter(message => message.action === 'getRottenTomatoesRatings');
  assert.equal(rtLookups.length, 0, 'a stored score must not be resolved again');
});

test('unloading flushes pending resolutions to disk', async t => {
  const fixture = openGrid({ rtScores: { rtCriticsScore: 88, rtAudienceScore: 77, confidence: 1 } });
  t.after(() => { fixture.dom.window.close(); });
  await flush(fixture.window);

  const bundle = await fixture.window.testOverlay.getRatings(999, 'Fresh', 2000, 'movie');
  assert.equal(bundle.rtCriticsScore, 88, 'resolves through the mocked worker');
  assert.equal(fixture.localStore[CACHE_KEY], undefined, 'the write is debounced, not immediate');

  fixture.window.dispatchEvent(new fixture.window.Event('pagehide'));
  for (let i = 0; i < 40; i++) await new Promise(resolve => setImmediate(resolve));

  const stored = fixture.localStore.overlayRatingsByServerV1?.['https://seerr.example'];
  assert.ok(stored, 'pagehide flushes instead of losing the resolutions');
  assert.equal(stored.entries['movie:999'].bundle.rtCriticsScore, 88);
  assert.ok(Array.isArray(stored.index), 'the title index rides along in the same write');
});

test('an index from another server is discarded', async t => {
  const fixture = openGrid({ local: seedBlob({ server: 'https://other.example/' }), plexConfigured: true });
  t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.dom.window.close(); });
  await flush(fixture.window);

  fixture.window.testOverlay.hydrateCardsFromListItems();
  fixture.window.testOverlay.injectPlexCardButtons();
  assert.equal(fixture.window.document.querySelectorAll('.seerr-plex-card-button').length, 0);
});

test('malformed index entries never identify a card', async t => {
  const fixture = openGrid({
    local: seedBlob({ index: [
      null, 'nonsense', 42,
      { tmdbId: 'abc', mediaType: 'movie', title: 'Evil', posterPath: '/p123.jpg' },
      { tmdbId: '123', mediaType: 'song', title: 'Evil', posterPath: '/p123.jpg' },
      { tmdbId: '123', mediaType: 'movie', title: 'Evil', posterPath: '/p123.jpg' }
    ] }),
    plexConfigured: true
  });
  t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.dom.window.close(); });
  await flush(fixture.window);

  fixture.window.testOverlay.hydrateCardsFromListItems();
  fixture.window.testOverlay.injectPlexCardButtons();
  const buttons = fixture.window.document.querySelectorAll('.seerr-plex-card-button');
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].getAttribute('aria-label'), 'Add Evil to Plex Watchlist');
});

test('the projected index is bounded and deduplicated', async t => {
  const fixture = openGrid();
  t.after(() => { fixture.dom.window.close(); });
  await flush(fixture.window);

  const raw = [];
  for (let i = 1; i <= 2500; i++) {
    raw.push({ id: i, mediaType: 'movie', title: `Title ${i}`, posterPath: `/p${i}.jpg`, releaseDate: '2020-01-01' });
    raw.push({ id: i, mediaType: 'movie', title: `Title ${i} dup`, posterPath: `/p${i}.jpg`, releaseDate: '2020-01-01' });
  }
  const projected = fixture.window.testOverlay.projectListIndex(raw);
  assert.ok(projected.length <= 2000, `index capped, got ${projected.length}`);
  assert.equal(new Set(projected.map(entry => `${entry.mediaType}:${entry.tmdbId}`)).size, projected.length);
});

test('new catalogue observations replace stale identities while preserving missing metadata on reload', async t => {
  const fixture = openGrid({ plexConfigured: true });
  t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.dom.window.close(); });
  await flush(fixture.window);
  const observe = items => fixture.window.testOverlay.handleObservedApiResponse({ source: fixture.window, origin: fixture.window.location.origin,
    data: { channel: 'super-seerr:api', url: '/api/v1/discover/movies', items } });
  observe([{ id: 123, mediaType: 'movie', title: 'Old title', originalTitle: 'Original title', posterPath: '/old.jpg', releaseDate: '2020-01-01' }]);
  observe([{ id: 123, mediaType: 'movie', title: 'New title', posterPath: '/p123.jpg', releaseDate: '2021-10-22' }]);
  // A partial request response must not erase the freshly observed identity.
  observe([{ media: { tmdbId: 123, mediaType: 'movie', title: 'New title' } }]);
  await fixture.window.testOverlay.flushPersistedRatings();
  const index = fixture.localStore.overlayRatingsByServerV1['https://seerr.example'].index;
  assert.equal(index.length, 1);
  assert.equal(index[0].title, 'New title');
  assert.equal(index[0].posterPath, '/p123.jpg');
  assert.equal(index[0].originalTitle, 'Original title');
  assert.equal(index[0].year, 2021);
  assert.equal(fixture.window.testOverlay.listItemCount(), 1, 'refetches cannot crowd out other titles');
  const reloaded = openGrid({ local: fixture.localStore, plexConfigured: true });
  t.after(() => { reloaded.window.dispatchEvent(new reloaded.window.Event('pagehide')); reloaded.dom.window.close(); });
  await flush(reloaded.window);
  reloaded.window.testOverlay.injectPlexCardButtons();
  assert.equal(reloaded.window.document.querySelector('.seerr-plex-card-button')?.getAttribute('aria-label'), 'Add New title to Plex Watchlist');
});

test('projecting catalogue updates keeps movie and TV identities separate and retains explicit years', async t => {
  const fixture = openGrid();
  t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.dom.window.close(); });
  await flush(fixture.window);
  const index = fixture.window.testOverlay.projectListIndex([
    { tmdbId: 123, mediaType: 'movie', title: 'Film', year: 2021, posterPath: '/film.jpg' },
    { tmdbId: 123, mediaType: 'tv', title: 'Series', year: 2024, posterPath: '/series.jpg' },
    { media: { tmdbId: 123, mediaType: 'movie', title: 'Updated Film' } }
  ]);
  assert.equal(index.length, 2);
  assert.equal(index.find(row => row.mediaType === 'movie').title, 'Updated Film');
  assert.equal(index.find(row => row.mediaType === 'movie').year, 2021);
  assert.equal(index.find(row => row.mediaType === 'movie').posterPath, '/film.jpg');
  assert.equal(index.find(row => row.mediaType === 'tv').year, 2024);
});

test('repeated catalogue refetches cannot evict unrelated useful titles', async t => {
  const fixture = openGrid({ local: seedBlob() });
  t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.dom.window.close(); });
  await flush(fixture.window);
  fixture.window.testOverlay.handleObservedApiResponse({ source: fixture.window, origin: fixture.window.location.origin,
    data: { channel: 'super-seerr:api', url: '/api/v1/discover/movies',
      items: Array.from({ length: Config.overlayCacheMaxEntries + 1 }, () => ({ id: 456, mediaType: 'movie', title: 'Repeated title', posterPath: '/repeated.jpg' })) } });
  await fixture.window.testOverlay.flushPersistedRatings();
  const index = fixture.localStore.overlayRatingsByServerV1['https://seerr.example'].index;
  assert.equal(index.length, 2);
  assert.ok(index.some(row => row.tmdbId === '123'), 'the stored Dune identity remains useful across refetches');
});

test('lists arriving before settings load are replayed, not dropped', async t => {
  // Cold boot: Seerr speaks before the worker answers getConfigState.
  const fixture = openGrid({ serverUrl: null, plexConfigured: true });
  t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.dom.window.close(); });
  for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));

  fixture.window.testOverlay.handleObservedApiResponse({
    source: fixture.window,
    origin: 'https://seerr.example',
    data: {
      channel: 'super-seerr:api',
      url: 'https://seerr.example/api/v1/discover/movies?page=1',
      items: [{ id: 123, mediaType: 'movie', title: 'Dune', posterPath: '/p123.jpg', releaseDate: '2021-10-22' }]
    }
  });
  for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));

  fixture.window.testOverlay.hydrateCardsFromListItems();
  fixture.window.testOverlay.injectPlexCardButtons();
  assert.equal(fixture.window.document.querySelectorAll('.seerr-plex-card-button').length, 0,
    'with no server known the event waits instead of identifying cards');

  // Saving the server URL replays the stashed lists through the live pipeline.
  fixture.saveServerUrl('https://seerr.example');
  let buttons = [];
  for (let i = 0; i < 150 && buttons.length === 0; i++) {
    await new Promise(resolve => setTimeout(resolve, 20));
    buttons = [...fixture.window.document.querySelectorAll('.seerr-plex-card-button')];
  }
  assert.equal(buttons.length, 1, 'the early list identifies the card once settings land');
  assert.equal(buttons[0].getAttribute('aria-label'), 'Add Dune to Plex Watchlist');
});

test('a direct RT flush coalesces the debounced one instead of writing twice', async () => {
  const { loadWorker } = require('./helpers/worker');
  const worker = loadWorker({ get: async () => ({}), local: {} });
  await worker.ready;

  worker.api.cacheRottenTomatoesResult('movie:Dune:', { rtCriticsScore: 90 }, 3600000);
  await worker.api.flushRtCache();
  await new Promise(resolve => setTimeout(resolve, 700));

  const writes = worker.localWrites.filter(written => written.rtCacheV1);
  assert.equal(writes.length, 1, 'the scheduled write must not repeat a flush that already covered it');
});




test('repeated identical lists do not make a card ambiguous to itself', async t => {
  const fixture = openGrid({ plexConfigured: true });
  t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.dom.window.close(); });
  await flush(fixture.window);

  // The same list refetched three times: pagination overlap and SPA
  // revisits produce exactly this. Identity is one title, not three matches.
  const event = {
    source: fixture.window,
    origin: 'https://seerr.example',
    data: {
      channel: 'super-seerr:api',
      url: 'https://seerr.example/api/v1/discover/movies',
      items: [{ id: 123, mediaType: 'movie', title: 'Dune', posterPath: '/p123.jpg', releaseDate: '2021-10-22' }]
    }
  };
  fixture.window.testOverlay.handleObservedApiResponse(event);
  fixture.window.testOverlay.handleObservedApiResponse(event);
  fixture.window.testOverlay.handleObservedApiResponse(event);
  for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve));

  fixture.window.testOverlay.hydrateCardsFromListItems();
  fixture.window.testOverlay.injectPlexCardButtons();
  const buttons = fixture.window.document.querySelectorAll('.seerr-plex-card-button');
  assert.equal(buttons.length, 1, 'duplicates collapse to the one identity they share');
  assert.equal(buttons[0].getAttribute('aria-label'), 'Add Dune to Plex Watchlist');
});


test('poster matching ignores query strings and shared filenames', async t => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<main><div id="grid">' +
    '<article data-testid="title-card"><div><img alt="" src="https://image.tmdb.org/t/p/w300/p123.jpg?width=300"></div></article>' +
    '<article data-testid="title-card"><div><img alt="" src="https://cdn.example/a/x.jpg"></div></article>' +
    '</div></main>', { url: 'https://seerr.example/discover', runScripts: 'outside-only' });
  const { window } = dom;
  t.after(() => { window.dispatchEvent(new window.Event('pagehide')); dom.window.close(); });
  const localStore = {
    overlayRatingsV1: {
      server: 'https://seerr.example/', epoch: 0, matcher: require('../src/shared/RatingsConfig').matcherVersion,
      entries: {},
      index: [
        { tmdbId: '123', mediaType: 'movie', title: 'Dune', originalTitle: '', year: 2021, posterPath: '/p123.jpg' },
        { tmdbId: '1', mediaType: 'movie', title: 'Aye', originalTitle: '', year: 2020, posterPath: '/a/x.jpg' },
        { tmdbId: '2', mediaType: 'movie', title: 'Bee', originalTitle: '', year: 2021, posterPath: '/b/x.jpg' }
      ]
    }
  };
  window.chrome = {
    storage: {
      sync: { get: async () => ({ seerrUrl: 'https://seerr.example' }) },
      local: {
        get: async keys => Object.fromEntries(
          (Array.isArray(keys) ? keys : [keys]).filter(key => localStore[key] !== undefined).map(key => [key, localStore[key]])),
        set: async value => { Object.assign(localStore, value); },
        remove: async keys => {}
      },
      onChanged: { addListener() {} }
    },
    runtime: { sendMessage: async message => {
      if (message.action === 'getConfigState') {
        return { success: true, data: { apiConfigured: false, serverUrl: 'https://seerr.example/', plexConfigured: true } };
      }
      return { success: true, data: null };
    } }
  };
  window.fetch = async () => ({ ok: true, json: async () => ({ results: [] }) });
  for (const file of ['RatingsModel', 'RatingsConfig']) window.eval(fs.readFileSync('src/shared/' + file + '.js', 'utf8'));
  const cacheMessage = require('./helpers/cache-bridge').cacheBridge({ settings: () => window.chrome.storage.sync.get(), local: window.chrome.storage.local, url: window.location.href });
  const send = window.chrome.runtime.sendMessage;
  window.chrome.runtime.sendMessage = message => ['getOverlayCache', 'putOverlayCache'].includes(message.action) ? cacheMessage(message) : send(message);
  require('./helpers/overlay-modules').loadOverlayModules(window);
  window.eval(fs.readFileSync('src/content/seerr-integration.js', 'utf8').replace(/\}\)\(\);\s*$/, 'window.testOverlay = { hydrateCardsFromListItems, injectPlexCardButtons }; })();'));
  for (let i = 0; i < 30; i++) await new Promise(resolve => setImmediate(resolve));
  window.testOverlay.hydrateCardsFromListItems();
  window.testOverlay.injectPlexCardButtons();
  const buttons = [...window.document.querySelectorAll('.seerr-plex-card-button')];
  assert.equal(buttons.length, 2, 'query-string poster and unique-path poster both resolve');
  assert.deepEqual(
    buttons.map(button => button.getAttribute('aria-label')),
    ['Add Dune to Plex Watchlist', 'Add Aye to Plex Watchlist']);
});
test('two different titles sharing a poster still refuse to resolve', async t => {
  const fixture = openGrid({ plexConfigured: true });
  t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.dom.window.close(); });
  await flush(fixture.window);

  fixture.window.testOverlay.handleObservedApiResponse({
    source: fixture.window,
    origin: 'https://seerr.example',
    data: {
      channel: 'super-seerr:api',
      url: 'https://seerr.example/api/v1/discover/movies',
      items: [
        { id: 123, mediaType: 'movie', title: 'Dune', posterPath: '/p123.jpg', releaseDate: '2021-10-22' },
        { id: 456, mediaType: 'movie', title: 'Other Film', posterPath: '/p123.jpg', releaseDate: '2022-01-01' }
      ]
    }
  });
  for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve));

  fixture.window.testOverlay.hydrateCardsFromListItems();
  fixture.window.testOverlay.injectPlexCardButtons();
  assert.equal(
    fixture.window.document.querySelectorAll('.seerr-plex-card-button').length, 0,
    'genuine ambiguity must still refuse, never guess');
});
test('a long browsing session keeps the title index bounded', async t => {
  const Config = require('../src/shared/RatingsConfig');
  const fixture = openGrid({ plexConfigured: true });
  t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.dom.window.close(); });
  await flush(fixture.window);

  // Thirty refetches of a 300-title list, as infinite scroll and SPA
  // revisits produce them. Duplicates must not accumulate without bound.
  for (let round = 0; round < 30; round++) {
    fixture.window.testOverlay.handleObservedApiResponse({
      source: fixture.window,
      origin: 'https://seerr.example',
      data: {
        channel: 'super-seerr:api',
        url: 'https://seerr.example/api/v1/discover/movies?page=' + (round + 1),
        items: Array.from({ length: 300 }, (_, i) => ({
          id: 1000 + i, mediaType: 'movie', title: 'Title ' + (1000 + i),
          posterPath: '/p' + (1000 + i) + '.jpg', releaseDate: '2020-01-01'
        }))
      }
    });
  }
  for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(
    fixture.window.testOverlay.listItemCount() <= Config.overlayCacheMaxEntries,
    'the live index never outgrows its cap no matter the traffic');
});
test('overlay toasts share one corner column and burst-evicted oldest-first', async t => {
  const fixture = openGrid();
  t.after(() => { fixture.dom.window.close(); });
  await flush(fixture.window);

  for (let i = 1; i <= 6; i++) fixture.window.testOverlay.notifyResult('Title ' + i, 'Message ' + i, 'info');
  const stack = fixture.window.document.querySelector('.seerr-notification-stack');
  assert.ok(stack, 'toasts share one stack container');
  assert.equal(stack.children.length, 4, 'a burst is capped instead of covering the page');
  await new Promise(resolve => setTimeout(resolve, 10));
  const titles = [...stack.children].map(note => note.querySelector('.seerr-notification-title').textContent);
  assert.deepEqual(titles, ['Title 3', 'Title 4', 'Title 5', 'Title 6']);
});
test('bulk review with nothing requestable cannot confirm an empty request', async t => {
  const fixture = openGrid({ apiConfigured: true });
  t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.dom.window.close(); });
  await flush(fixture.window);

  // Bulk mode on, then select only the poster no title list can identify.
  fixture.window.testOverlay.toggleBulkMode();
  const cards = fixture.window.document.querySelectorAll('[data-testid="title-card"]');
  cards[1].querySelector('.seerr-select-checkbox').click();
  fixture.window.document.querySelector('.seerr-bulk-review').click();

  const modal = fixture.window.document.querySelector('.seerr-confirmation-modal');
  assert.ok(modal, 'review still opens to explain the exclusion');
  const confirm = modal.querySelector('.confirm-btn');
  assert.match(confirm.textContent, /Request 0 titles/);
  assert.equal(confirm.disabled, true, 'zero ready titles is not confirmable');
  confirm.click();
  for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(
    fixture.messages.filter(message => message.action === 'requestMedia').length, 0,
    'a disabled confirm sends nothing');
  assert.ok(modal.isConnected, 'and the review stays open');
});

for (const mediaType of ['movie', 'tv']) {
  for (const matchedYear of [1984, 2021]) {
    test(`${mediaType} cards gate shared cache reconciliation on the catalogue year (${matchedYear})`, async t => {
      const now = Date.now();
      const fixture = openGrid({ local: {
        [CACHE_KEY]: { server: SERVER, epoch: 0, matcher: Config.matcherVersion,
          entries: { [`${mediaType}:123`]: { bundle: BUNDLE, cachedAt: now - 100000 } },
          index: [{ ...INDEX_ENTRY, mediaType }] },
        publicRatingsV1: { matcher: Config.matcherVersion, entries: { [`${mediaType}:123`]: {
          source: 'rotten-tomatoes', checkedAt: now - 1000, expiresAt: now - 1000 + Config.rtCacheTtlMs,
          value: { rtCriticsScore: 99, rtAudienceScore: 98, confidence: 1, source: 'rotten-tomatoes',
            matchedTitle: 'Dune', matchedYear, url: `https://www.rottentomatoes.com/${mediaType === 'tv' ? 'tv' : 'm'}/dune` }
        } } }
      } });
      t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.window.close(); });
      await flush(fixture.window);
      const card = fixture.window.document.querySelector('[data-testid="title-card"]');
      assert.equal(card.__seerrListMediaInfo.year, 2021);
      assert.equal(card.__seerrRatings.rtCriticsScore, matchedYear === 2021 ? 99 : 90,
        'a contradictory public year must not overwrite the server-specific cached score');
      assert.equal(card.__seerrRatings.imdbRating, 7, 'native IMDb survives public RT reconciliation');
    });
  }
}

const observeCatalogue = (fixture, item) => fixture.window.testOverlay.handleObservedApiResponse({
  source: fixture.window, origin: fixture.window.location.origin,
  data: { channel: 'super-seerr:api', url: 'https://seerr.example/api/v1/discover/movies', items: [item] }
});

test('anchored cards receive catalogue metadata by exact type and ID, ignoring a misleading poster', async t => {
  const fixture = openGrid({ local: seedBlob({ index: [INDEX_ENTRY,
    { tmdbId: '456', mediaType: 'movie', title: 'Arrival', year: 2016, posterPath: '/p456.jpg' },
    { tmdbId: '456', mediaType: 'tv', title: 'Other Series', year: 2024, posterPath: '/tv.jpg' }
  ] }) });
  t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.window.close(); });
  const card = fixture.window.document.querySelector('[data-testid="title-card"]');
  card.innerHTML = '<a href="/movie/456"><img src="https://image.tmdb.org/t/p/w300/p123.jpg" alt="Arrival"></a>';
  await flush(fixture.window);
  assert.equal(card.__seerrMediaInfo.tmdbId, '456');
  assert.equal(card.__seerrMediaInfo.year, 2016);
  assert.equal(card.__seerrMediaInfo.title, 'Arrival');
});

test('live catalogue metadata refreshes card actions while keeping the same identity selected', async t => {
  const fixture = openGrid({ local: seedBlob({ entries: { 'movie:123': { bundle: BUNDLE, cachedAt: Date.now() } } }), plexConfigured: true, apiConfigured: true });
  t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.window.close(); });
  await flush(fixture.window);
  fixture.window.testOverlay.toggleBulkMode(true);
  const card = fixture.window.document.querySelector('[data-testid="title-card"]');
  card.querySelector('.seerr-select-checkbox').click();
  observeCatalogue(fixture, { id: 123, mediaType: 'movie', title: 'Updated Dune', releaseDate: '2022-01-01', posterPath: '/p123.jpg' });
  fixture.window.testOverlay.injectCardBadges();
  fixture.window.testOverlay.injectPlexCardButtons();
  fixture.window.testOverlay.injectSortFilterControls();
  await flush(fixture.window);
  assert.equal(card.__seerrListMediaInfo.year, 2022);
  assert.equal(card.__seerrListMediaInfo.title, 'Updated Dune');
  assert.equal(card.querySelector('.seerr-select-checkbox').getAttribute('aria-checked'), 'true');
  fixture.window.testOverlay.toggleBulkMode();
  assert.equal(card.querySelector('.seerr-plex-card-button').getAttribute('aria-label'), 'Add Updated Dune to Plex Watchlist');
});

test('a late rating for older same-ID metadata cannot repaint the updated card', async t => {
  const fixture = openGrid({ local: seedBlob() });
  t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.window.close(); });
  const send = fixture.window.chrome.runtime.sendMessage;
  let finishOld;
  fixture.window.chrome.runtime.sendMessage = message => {
    if (message.action !== 'getRottenTomatoesRatings') return send(message);
    if (message.data.year === 2021) return new Promise(resolve => { finishOld = resolve; });
    return Promise.resolve({ success: true, data: { rtCriticsScore: 20, rtAudienceScore: 30, confidence: 1 } });
  };
  await flush(fixture.window);
  assert.equal(typeof finishOld, 'function');
  observeCatalogue(fixture, { id: 123, mediaType: 'movie', title: 'Updated Dune', releaseDate: '2022-01-01', posterPath: '/p123.jpg' });
  fixture.window.testOverlay.injectCardBadges();
  await flush(fixture.window);
  const card = fixture.window.document.querySelector('[data-testid="title-card"]');
  assert.equal(card.__seerrRatings.rtCriticsScore, 20);
  finishOld({ success: true, data: { rtCriticsScore: 99, rtAudienceScore: 98, confidence: 1 } });
  await flush(fixture.window);
  assert.equal(card.__seerrRatings.rtCriticsScore, 20);
  assert.equal((await fixture.window.testOverlay.getRatings(123, 'Updated Dune', 2022, 'movie')).rtCriticsScore, 20);
});

test('enriching a newly added duplicate card keeps the existing shared lookup', async t => {
  const fixture = openGrid({ local: seedBlob() });
  t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.window.close(); });
  const send = fixture.window.chrome.runtime.sendMessage;
  let finish, calls = 0;
  fixture.window.chrome.runtime.sendMessage = message => {
    if (message.action !== 'getRottenTomatoesRatings') return send(message);
    calls++;
    return new Promise(resolve => { finish = resolve; });
  };
  await flush(fixture.window);
  const duplicate = fixture.window.document.createElement('article');
  duplicate.dataset.testid = 'title-card';
  duplicate.innerHTML = '<a href="/movie/123"><h2>Dune</h2></a>';
  fixture.window.document.getElementById('grid').append(duplicate);
  fixture.window.testOverlay.injectCardBadges();
  await flush(fixture.window);
  assert.equal(calls, 1, 'metadata enrichment must not cancel another card\'s correct lookup');
  finish({ success: true, data: { rtCriticsScore: 80, rtAudienceScore: 90, confidence: 1 } });
  await flush(fixture.window);
  assert.equal(duplicate.__seerrRatings.rtCriticsScore, 80);
  assert.equal(duplicate.__seerrMediaInfo.year, 2021);
});

for (const year of [2021, 1984]) test(`live public rating notification respects the card year (${year}) and preserves native scores`, async t => {
  const checkedAt = Date.now() - 10000;
  const fixture = openGrid({ local: { overlayRatingsV1: {
    server: SERVER, epoch: 0, matcher: Config.matcherVersion, index: [INDEX_ENTRY],
    entries: { 'movie:123': { bundle: BUNDLE, cachedAt: checkedAt, retryAt: Date.now() + 100000 } }
  } } });
  t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.window.close(); });
  await flush(fixture.window);
  const card = fixture.window.document.querySelector('article');
  assert.equal(card.__seerrRatings.rtCriticsScore, 90);
  const send = fixture.window.chrome.runtime.sendMessage;
  fixture.window.chrome.runtime.sendMessage = async message => {
    const reply = await send(message);
    if (message.action === 'getOverlayCache') reply.data.publicRatingsV1 = { matcher: Config.matcherVersion, entries: {
      'movie:123': { source: 'rotten-tomatoes', checkedAt: checkedAt + 1000, expiresAt: checkedAt + Config.rtCacheTtlMs,
        value: { rtCriticsScore: 99, rtAudienceScore: 85, confidence: 1, source: 'rotten-tomatoes',
          matchedTitle: 'Dune', matchedYear: year, url: 'https://www.rottentomatoes.com/m/dune' } }
    } };
    return reply;
  };
  fixture.notify({ action: 'publicRatingsChanged' });
  await flush(fixture.window);
  assert.equal(card.__seerrRatings.rtCriticsScore, year === 2021 ? 99 : 90);
  assert.equal(card.__seerrRatings.imdbRating, 7);
  assert.equal(card.__seerrRatings.tmdbRating, 7.5);
  assert.equal(fixture.window.testOverlay.listItemCount(), 1);
  assert.equal(fixture.messages.filter(message => message.action === 'getRottenTomatoesRatings').length, 0);
});

for (const status of ['uncertain', 'partial', 'unrated', 'failed']) {
  for (const complete of [false, true]) test(`shared ratings repair score details (${status}, complete: ${complete})`, async t => {
    const checkedAt = Date.now() - 10000;
    const native = { ...BUNDLE, rtCriticsScore: null, rtAudienceScore: null,
      ...(complete ? {} : { imdbRating: null }) };
    const fixture = openGrid({ local: { overlayRatingsV1: {
      server: SERVER, epoch: 0, matcher: Config.matcherVersion, index: [INDEX_ENTRY],
      entries: { 'movie:123': { bundle: native, cachedAt: checkedAt, retryAt: Date.now() + 100000,
        diagnostics: { status, checkedAt, source: 'seerr-native' } } }
    } } });
    t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.window.close(); });
    await flush(fixture.window);
    if (status === 'uncertain') assert.match(fixture.window.document.querySelector('article .seerr-rating-details p').textContent,
      /match was uncertain/, 'an unresolved RT match still explains why its score is hidden');
    const send = fixture.window.chrome.runtime.sendMessage;
    fixture.window.chrome.runtime.sendMessage = async message => {
      const reply = await send(message);
      if (message.action === 'getOverlayCache') reply.data.publicRatingsV1 = { matcher: Config.matcherVersion, entries: {
        'movie:123': { source: 'rotten-tomatoes', checkedAt: checkedAt + 1000, expiresAt: checkedAt + Config.rtCacheTtlMs,
          value: { rtCriticsScore: 0, rtAudienceScore: 85, confidence: 1, source: 'rotten-tomatoes',
            matchedTitle: 'Dune', matchedYear: 2021, url: 'https://www.rottentomatoes.com/m/dune' } }
      } };
      return reply;
    };
    fixture.notify({ action: 'publicRatingsChanged' });
    await flush(fixture.window);
    const card = fixture.window.document.querySelector('article');
    assert.equal(card.__seerrRatings.rtCriticsScore, 0, 'a verified zero is still a rating');
    assert.equal(card.__seerrRatings.tmdbRating, 7.5);
    const explanation = card.querySelector('.seerr-rating-details p').textContent;
    assert.match(explanation, status === 'failed' ? /A lookup failed/ : complete
      ? /All score sources returned ratings/ : /Some sources have no score/);
    assert.doesNotMatch(explanation, /match was uncertain|No source returned a rating/);
    assert.equal(fixture.messages.filter(message => message.action === 'getRottenTomatoesRatings').length, 0);
    await fixture.window.testOverlay.flushPersistedRatings();
    assert.equal(fixture.localStore.overlayRatingsByServerV1['https://seerr.example'].entries['movie:123'].diagnostics.status,
      status === 'failed' ? 'failed' : complete ? 'rated' : 'partial');
  });
}

for (const placement of ['card', 'detail']) for (const focused of ['summary', 'button', 'elsewhere', 'closed']) test(`live shared updates preserve ${placement} score details and ${focused} focus`, async t => {
  const checkedAt = Date.now() - 10000;
  const fixture = openGrid({ detail: placement === 'detail', pageUrl: `https://seerr.example/${placement === 'detail' ? 'movie/123' : 'discover'}`, local: { overlayRatingsV1: {
    server: SERVER, epoch: 0, matcher: Config.matcherVersion, index: [INDEX_ENTRY],
    entries: { 'movie:123': { bundle: BUNDLE, cachedAt: checkedAt, retryAt: Date.now() + 100000 } }
  } } });
  t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.window.close(); });
  await flush(fixture.window);
  const doc = fixture.window.document;
  const card = doc.querySelector(placement === 'detail' ? '.media-header' : 'article');
  const original = card.querySelector('.seerr-rating-details');
  original.open = focused !== 'closed';
  const control = ['elsewhere', 'closed'].includes(focused) ? 'summary' : focused;
  original.querySelector(control).focus();
  const send = fixture.window.chrome.runtime.sendMessage;
  let release;
  fixture.window.chrome.runtime.sendMessage = async message => {
    const reply = await send(message);
    if (message.action !== 'getOverlayCache') return reply;
    reply.data.publicRatingsV1 = { matcher: Config.matcherVersion, entries: {
      'movie:123': { source: 'rotten-tomatoes', checkedAt: checkedAt + 1000, expiresAt: checkedAt + Config.rtCacheTtlMs,
        value: { rtCriticsScore: 99, rtAudienceScore: 85, confidence: 1, source: 'rotten-tomatoes',
          matchedTitle: 'Dune', matchedYear: 2021, url: 'https://www.rottentomatoes.com/m/dune' } }
    } };
    return new Promise(resolve => { release = () => resolve(reply); });
  };
  fixture.notify({ action: 'publicRatingsChanged' });
  await flush(fixture.window);
  const outside = doc.createElement('button'); doc.body.append(outside);
  if (focused === 'elsewhere') {
    const observer = new fixture.window.MutationObserver(() => {
      if (!original.isConnected) { outside.focus(); observer.disconnect(); }
    });
    observer.observe(card, { childList: true });
    t.after(() => observer.disconnect());
  }
  release(); await flush(fixture.window);
  const updated = card.querySelector('.seerr-rating-details');
  if (placement === 'card') assert.equal(card.__seerrRatings.rtCriticsScore, 99);
  else assert.match(card.querySelector('.seerr-ratings-row').textContent, /99%/);
  assert.equal(updated.open, focused !== 'closed', 'repainting preserves the explanation state');
  assert.equal(doc.activeElement, focused === 'elsewhere' ? outside : updated.querySelector(control));
});

for (const liveYear of [null, 2022]) test(`a delayed stored catalogue fills gaps and preserves live metadata (year: ${liveYear})`, async t => {
  const f = openGrid({ local: seedBlob(), plexConfigured: true, deferCache: true });
  t.after(() => { f.window.dispatchEvent(new f.window.Event('pagehide')); f.dom.window.close(); });
  await flush(f.window);
  f.window.testOverlay.handleObservedApiResponse({ source: f.window, origin: f.window.location.origin,
    data: { channel: 'super-seerr:api', url: '/api/v1/request', items: [
      { tmdbId: 123, mediaType: 'movie', title: 'Fresh Dune', ...(liveYear ? { releaseDate: `${liveYear}-01-01` } : {}) }
    ] } });
  f.releaseCache(); await flush(f.window);
  f.window.testOverlay.hydrateCardsFromListItems();
  f.window.testOverlay.injectPlexCardButtons();
  const index = f.window.testOverlay.projectListIndex();
  const title = index.find(item => item.tmdbId === '123');
  assert.equal(title.title, 'Fresh Dune');
  assert.equal(title.year, liveYear ?? 2021);
  assert.equal(title.posterPath, '/p123.jpg');
  const button = f.window.document.querySelector('.seerr-plex-card-button');
  assert.ok(button, 'the cached poster must still identify the card');
  assert.equal(button.getAttribute('aria-label'), 'Add Fresh Dune to Plex Watchlist');
});

test('cached-only catalogue records cannot evict fresher live observations at the limit', async t => {
  const f = openGrid();
  t.after(() => { f.window.dispatchEvent(new f.window.Event('pagehide')); f.dom.window.close(); });
  await flush(f.window);
  const live = Array.from({ length: Config.overlayCacheMaxEntries }, (_, i) => ({
    tmdbId: String(10000 + i), mediaType: 'movie', title: `Live ${i}`
  }));
  f.window.testOverlay.rememberListItems(live);
  f.window.testOverlay.restoreListIndex([INDEX_ENTRY]);
  assert.equal(f.window.testOverlay.listItemCount(), Config.overlayCacheMaxEntries);
  const projected = f.window.testOverlay.projectListIndex(undefined, Config.overlayCacheMaxEntries);
  assert.equal(projected[0].tmdbId, '10000');
  assert.equal(projected.some(item => item.tmdbId === '123'), false);
});

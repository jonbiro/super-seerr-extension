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

function openGrid({ local = {}, plexConfigured = false, rtScores = null, serverUrl = 'https://seerr.example' } = {}) {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(`<main><div id="grid">${CARDS}</div></main>`,
    { url: 'https://seerr.example/discover', runScripts: 'outside-only' });
  const { window } = dom;
  const localStore = { ...local };
  const syncStore = { ...(serverUrl ? { seerrUrl: serverUrl } : {}) };
  let changeListener = null;
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
    runtime: { sendMessage: async message => {
      messages.push(message);
      if (message.action === 'getConfigState') {
        return { success: true, data: { apiConfigured: false, serverUrl: SERVER, plexConfigured } };
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
  require('./helpers/overlay-modules').loadOverlayModules(window);
  window.eval(fs.readFileSync('src/content/seerr-integration.js', 'utf8').replace(/\}\)\(\);\s*$/, `window.testOverlay = {
    injectCardBadges, injectPlexCardButtons, hydrateCardsFromListItems, getRatings,
    flushPersistedRatings, projectListIndex, detectRoute, handleObservedApiResponse
  }; })();`));
  return {
    dom, window, messages, localStore,
    saveServerUrl: url => {
      syncStore.seerrUrl = url;
      return changeListener?.({ seerrUrl: { newValue: url } }, 'sync');
    }
  };
}

const flush = async (window, rounds = 40) => {
  for (let i = 0; i < rounds; i++) await new Promise(resolve => setImmediate(resolve));
};

function seedBlob({ entries = {}, index = [INDEX_ENTRY], server = SERVER, matcher = Config.matcherVersion } = {}) {
  return { [CACHE_KEY]: { server, epoch: 0, matcher, entries, index } };
}

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

  const stored = fixture.localStore[CACHE_KEY];
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

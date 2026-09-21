const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const Config = require('../src/shared/RatingsConfig');

const source = file => fs.readFileSync(file, 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let i = 0; i < 12; i++) await flush(); }

function createOverlay({ settings = {}, path = '/search?query=test', embedded = null, listItems = [], linkless = false, wrapped = false, posters = false, audience = false, tv = false } = {}) {
  const dom = new JSDOM(`<main><div id="grid">${['Low', 'High', 'Unknown'].map((title, index) => `<article data-testid="title-card" data-id="${index + 1}"><a href="/${tv && index === 0 ? 'tv' : 'movie'}/${index + 1}"><h2>${title}</h2></a></article>`).join('')}</div></main>`, { url: `https://seerr.example${path}`, runScripts: 'outside-only' });
  const { window } = dom;
  if (posters) window.document.querySelectorAll('[data-testid="title-card"]').forEach((card, index) => {
    card.innerHTML = `<div role="link"><img alt="" src="https://image.tmdb.org/t/p/w300/poster${index + 1}.jpg"></div>`;
  });
  if (wrapped) window.document.querySelectorAll('[data-testid="title-card"]').forEach(card => {
    const item = window.document.createElement('li');
    card.replaceWith(item); item.append(card);
  });
  if (linkless) window.document.querySelectorAll('a').forEach(link => link.replaceWith(...link.childNodes));
  const storage = { seerrUrl: 'https://seerr.example', seerrApiKey: 'fixture', ...settings };
  let storageListener;
  const messages = [];
  const urls = [];
  // The overlay reads the URL and flags from sync but asks the worker whether
  // requests are enabled, so the key is never exposed to the page.
  const syncedStorage = () => Object.fromEntries(Object.entries(storage).filter(([key]) => key !== 'seerrApiKey'));
  window.chrome = {
    storage: {
      sync: { get: async () => syncedStorage(), set: async values => Object.assign(storage, values) },
      // MV3 always provides these; a mock without them fails code that is fine.
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      onChanged: { addListener(fn) { storageListener = fn; } }
    },
    runtime: { sendMessage: async message => {
      messages.push(message);
      if (message.action === 'getConfigState') {
        return { success: true, data: { apiConfigured: !!storage.seerrApiKey, serverUrl: storage.seerrUrl ?? null } };
      }
      return { success: true, data: message.action === 'getRottenTomatoesRatings' ? {
        rtCriticsScore: { Low: 30, High: 95 }[message.data.title] ?? null,
        // Opt-in, so the cards in every other test keep a single badge.
        ...(audience ? { rtAudienceScore: 88 } : {}),
        confidence: 0.9
      } : {} };
    } }
  };
  window.fetch = async url => { urls.push(url); return { ok: true, json: async () => ({ results: url.includes('/search?') ? listItems : [] }) }; };
  if (embedded) {
    const script = window.document.createElement('script');
    script.type = 'application/json';
    script.textContent = JSON.stringify(embedded);
    window.document.head.append(script);
  }
  const cacheMessage = require('./helpers/cache-bridge').cacheBridge({ settings: syncedStorage(), local: window.chrome.storage.local, url: window.location.href });
  const send = window.chrome.runtime.sendMessage;
  window.chrome.runtime.sendMessage = message => ['getOverlayCache', 'putOverlayCache'].includes(message.action) ? cacheMessage(message) : send(message);
  for (const file of ['RatingsModel', 'RatingsConfig']) window.eval(source(`src/shared/${file}.js`));
  require('./helpers/overlay-modules').loadOverlayModules(window);
  window.eval(source('src/content/seerr-integration.js').replace(/\}\)\(\);\s*$/, `window.testOverlay = { injectCardBadges, injectSortFilterControls, handleRouteChange, extractSeerrNativeRatings, loadMoreCards, scoreAllCards }; })();`));
  return { dom, window, messages, urls, storage, change: changes => storageListener(changes, 'sync') };
}

test('real DOM sorting follows ratings, stays idempotent and restores original order', async t => {
  const fixture = createOverlay(); t.after(() => (fixture.window.dispatchEvent(new fixture.window.Event('pagehide')), fixture.dom.window.close()));
  await settle();
  const doc = fixture.window.document;
  const order = () => [...doc.querySelectorAll('#grid > article')].map(el => el.dataset.id).join(',');
  assert.equal(doc.querySelectorAll('#seerr-filter-bar').length, 1);
  assert.equal(doc.querySelectorAll('.seerr-card-badge').length, 2);
  const select = doc.querySelector('.seerr-sort-select');
  select.value = 'rt-critics-desc'; select.dispatchEvent(new fixture.window.Event('change'));
  assert.equal(order(), '2,1,3');
  fixture.window.testOverlay.injectCardBadges(); fixture.window.testOverlay.injectSortFilterControls();
  await settle();
  assert.equal(doc.querySelectorAll('.seerr-card-badge').length, 2);
  select.value = 'default'; select.dispatchEvent(new fixture.window.Event('change'));
  assert.equal(order(), '1,2,3');
});

test('saved feature toggles hide badges without disabling score sorting', async t => {
  const fixture = createOverlay({ settings: { overlayFeatures: { cardBadges: false } } }); t.after(() => (fixture.window.dispatchEvent(new fixture.window.Event('pagehide')), fixture.dom.window.close()));
  await settle();
  const doc = fixture.window.document;
  assert.equal(doc.querySelectorAll('.seerr-card-badge').length, 0);
  const select = doc.querySelector('.seerr-sort-select');
  select.value = 'rt-critics-desc'; select.dispatchEvent(new fixture.window.Event('change'));
  assert.equal(doc.querySelector('#grid > article').dataset.id, '2');
  fixture.storage.overlayFeatures = { cardBadges: false, sortFilter: false };
  fixture.change({ overlayFeatures: { newValue: fixture.storage.overlayFeatures } });
  await settle();
  assert.equal(doc.querySelector('#seerr-filter-bar'), null);
  assert.equal(doc.querySelector('#grid > article').dataset.id, '1');
});

test('query navigation clears filters and base-path session requests stay under the server path', async t => {
  const fixture = createOverlay({ settings: { seerrUrl: 'https://seerr.example/seerr' }, path: '/seerr/search?query=test' }); t.after(() => (fixture.window.dispatchEvent(new fixture.window.Event('pagehide')), fixture.dom.window.close()));
  await settle();
  assert.ok(fixture.urls.some(url => url === 'https://seerr.example/seerr/api/v1/search?query=test'));
  const input = fixture.window.document.querySelector('.seerr-min-critics');
  input.value = '80'; input.dispatchEvent(new fixture.window.Event('input'));
  assert.equal(fixture.window.document.querySelector('[data-id="1"]').style.display, 'none');
  fixture.window.history.pushState({}, '', '/seerr/search?query=next');
  fixture.window.testOverlay.handleRouteChange(); await settle();
  assert.equal(fixture.window.document.querySelector('[data-id="1"]').style.display, '');
  assert.equal(fixture.window.document.querySelectorAll('#seerr-filter-bar').length, 1);
});

test('embedded movie and TV ratings with the same ID remain separate', async t => {
  const fixture = createOverlay({ embedded: { results: [{ id: 7, mediaType: 'movie', rtCriticsScore: 20 }, { id: 7, mediaType: 'tv', rtCriticsScore: 90 }] } }); t.after(() => (fixture.window.dispatchEvent(new fixture.window.Event('pagehide')), fixture.dom.window.close()));
  await settle();
  assert.equal(fixture.window.testOverlay.extractSeerrNativeRatings(7, 'movie').rtCriticsScore, 20);
  assert.equal(fixture.window.testOverlay.extractSeerrNativeRatings(7, 'tv').rtCriticsScore, 90);
});

test('options edits and connection tests do not save; explicit save includes feature flags', async t => {
  const dom = new JSDOM(source('src/options/options.html'), { url: 'https://extension.example/options', runScripts: 'outside-only' }); t.after(() => dom.window.close());
  const writes = [], messages = [];
  dom.window.chrome = { storage: { sync: { get: async () => ({ seerrUrl: 'https://original.example', seerrApiKey: '' }), set: async data => writes.push(data) } }, runtime: { sendMessage: async message => { messages.push(message); return { success: true, data: { user: 'Tester' } }; } } };
  dom.window.eval(source('src/options/options.js').split('// Initialize when DOM is loaded')[0] + '\nwindow.manager = new OptionsManager();');
  await settle();
  const doc = dom.window.document;
  doc.querySelector('#serverUrl').value = 'https://new.example';
  doc.querySelector('#apiKey').value = 'test-key';
  doc.querySelector('[data-overlay-feature="cardBadges"]').checked = false;
  await dom.window.manager.testConnection();
  assert.equal(writes.length, 0);
  assert.equal(messages[0].data.seerrUrl, 'https://new.example');
  await dom.window.manager.saveSettings();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].overlayFeatures.cardBadges, false);
});

test('bulk dialog supports keyboard selection and cancellation stops subsequent requests', async t => {
  const fixture = createOverlay(); t.after(() => (fixture.window.dispatchEvent(new fixture.window.Event('pagehide')), fixture.dom.window.close()));
  await settle();
  const doc = fixture.window.document;
  doc.querySelector('.seerr-toggle-select').click();
  const boxes = doc.querySelectorAll('.seerr-select-checkbox');
  boxes[0].click(); boxes[1].click();
  assert.equal(boxes[0].tagName, 'BUTTON');
  assert.equal(boxes[0].getAttribute('aria-checked'), 'true');
  doc.querySelector('.seerr-bulk-review').click();
  assert.equal(doc.querySelector('[role="dialog"]').getAttribute('aria-modal'), 'true');
  assert.equal(doc.activeElement.className, 'cancel-btn');
  let requests = 0, release;
  const originalSend = fixture.window.chrome.runtime.sendMessage;
  fixture.window.chrome.runtime.sendMessage = message => {
    if (message.action !== 'requestMedia') return originalSend(message);
    requests++; return new Promise(resolve => { release = resolve; });
  };
  doc.querySelector('.confirm-btn').click();
  assert.equal(requests, 1);
  doc.querySelector('[role="dialog"]').dispatchEvent(new fixture.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  release({ success: true });
  await new Promise(resolve => setTimeout(resolve, 550));
  assert.equal(requests, 1);
  assert.equal(doc.querySelector('[role="dialog"]'), null);
});

test('linkless cards use unique title matches rather than list positions', async t => {
  const fixture = createOverlay({ linkless: true, listItems: [
    { id: 22, mediaType: 'movie', title: 'High' },
    { id: 11, mediaType: 'movie', title: 'Low' },
    { id: 33, mediaType: 'movie', title: 'Unknown' },
    { id: 44, mediaType: 'movie', title: 'Unknown' }
  ] });
  t.after(() => (fixture.window.dispatchEvent(new fixture.window.Event('pagehide')), fixture.dom.window.close()));
  await settle();
  const cards = fixture.window.document.querySelectorAll('#grid > article');
  assert.equal(cards[0].__seerrListMediaInfo.tmdbId, '11');
  assert.equal(cards[1].__seerrListMediaInfo.tmdbId, '22');
  assert.equal(cards[2].__seerrListMediaInfo, undefined);
});


test('Seerr list-item wrappers sort as complete cards and reset without empty slots', async t => {
  const fixture = createOverlay({ wrapped: true });
  t.after(() => (fixture.window.dispatchEvent(new fixture.window.Event('pagehide')), fixture.dom.window.close()));
  await settle();
  const doc = fixture.window.document;
  const order = () => [...doc.querySelectorAll('#grid > li > article')].map(el => el.dataset.id).join(',');
  assert.equal(doc.querySelector('#seerr-filter-bar').nextElementSibling.id, 'grid');
  assert.equal(doc.querySelector('.seerr-score-coverage').textContent, '2/3 scored');
  const select = doc.querySelector('.seerr-sort-select');
  select.value = 'rt-critics-desc'; select.dispatchEvent(new fixture.window.Event('change'));
  assert.equal(order(), '2,1,3');
  const input = doc.querySelector('.seerr-min-critics');
  input.value = '80'; input.dispatchEvent(new fixture.window.Event('input'));
  assert.equal(doc.querySelector('[data-id="1"]').parentElement.style.display, 'none');
  doc.querySelector('.seerr-reset-sort').click();
  assert.equal(order(), '1,2,3');
  assert.ok([...doc.querySelectorAll('#grid > li')].every(item => item.style.display === '' && item.children.length === 1));
  select.value = 'rt-critics-desc'; select.dispatchEvent(new fixture.window.Event('change'));
  fixture.storage.overlayFeatures = { sortFilter: false, cardBadges: false };
  fixture.change({ overlayFeatures: { newValue: fixture.storage.overlayFeatures } });
  await settle();
  assert.equal(order(), '1,2,3');
});


test('poster-only Seerr cards resolve by exact poster identity instead of API order', async t => {
  const fixture = createOverlay({ wrapped: true, posters: true, listItems: [
    { id: 2, mediaType: 'movie', title: 'High', posterPath: '/poster2.jpg' },
    { id: 1, mediaType: 'movie', title: 'Low', posterPath: '/poster1.jpg' }
  ] });
  t.after(() => (fixture.window.dispatchEvent(new fixture.window.Event('pagehide')), fixture.dom.window.close()));
  await settle();
  const doc = fixture.window.document;
  assert.equal(doc.querySelector('.seerr-score-coverage').textContent, '2/3 scored');
  const select = doc.querySelector('.seerr-sort-select');
  select.value = 'rt-critics-desc'; select.dispatchEvent(new fixture.window.Event('change'));
  assert.equal(doc.querySelector('#grid > li > article').dataset.id, '2');
  assert.equal(doc.querySelector('[data-id="3"] .seerr-card-badge'), null);
});

test('the refresh button refetches the loaded titles and reports cache age', async t => {
  const fixture = createOverlay(); t.after(() => (fixture.window.dispatchEvent(new fixture.window.Event('pagehide')), fixture.dom.window.close()));
  await settle();
  const doc = fixture.window.document;

  const before = fixture.messages.filter(m => m.action === 'getRottenTomatoesRatings').length;
  assert.ok(before > 0, 'the page should have resolved its cards on load');

  const button = doc.querySelector('.seerr-refresh-scores');
  assert.ok(button, 'the filter bar should offer a refresh');
  button.click();
  await settle();

  const refreshes = fixture.messages.filter(m => m.action === 'getRottenTomatoesRatings' && m.data.refresh === true);
  assert.ok(refreshes.length > 0, 'refreshing must ask the worker to bypass its own cache');
  assert.ok(doc.querySelectorAll('.seerr-card-badge').length > 0, 'badges should be rebuilt, not left removed');
  assert.ok(doc.querySelector('.seerr-cache-age'), 'the bar should carry a cache-age label');
});

test('an ordinary card lookup does not ask the worker to bypass its cache', async t => {
  const fixture = createOverlay(); t.after(() => (fixture.window.dispatchEvent(new fixture.window.Event('pagehide')), fixture.dom.window.close()));
  await settle();
  const lookups = fixture.messages.filter(m => m.action === 'getRottenTomatoesRatings');
  assert.ok(lookups.length > 0);
  assert.ok(lookups.every(m => m.data.refresh !== true), 'only an explicit refresh may bypass the cache');
});

test('a card with no link is resolved from observed API traffic, without a hover', async t => {
  // Seerr's TitleCard keeps its link, title and alt text inside a Transition
  // that unmounts until hover, so before this the card sat unresolved.
  const fixture = createOverlay({ posters: true, linkless: true });
  t.after(() => (fixture.window.dispatchEvent(new fixture.window.Event('pagehide')), fixture.dom.window.close()));
  await settle();

  const doc = fixture.window.document;
  assert.equal(doc.querySelectorAll('.seerr-card-badge').length, 0, 'nothing identifies these cards yet');

  // What the page-world observer forwards after Seerr fetches its own slider.
  // Dispatched directly because jsdom's postMessage leaves event.source unset,
  // and the listener requires it to be this window.
  observe(fixture, [
    { id: 11, mediaType: 'movie', title: 'Low', posterPath: '/poster1.jpg' },
    { id: 22, mediaType: 'movie', title: 'High', posterPath: '/poster2.jpg' }
  ]);
  await settle();

  const cards = [...doc.querySelectorAll('#grid > article')];
  assert.equal(cards[0].__seerrListMediaInfo?.tmdbId, '11', 'the poster identifies the card immediately');

  // Badge injection is coalesced behind a short timer, so wait past it.
  await new Promise(resolve => setTimeout(resolve, 300));
  await settle();
  assert.equal(cards[0].__seerrListMediaInfo?.tmdbId, '11', 'the poster identifies the card');
  assert.equal(cards[1].__seerrListMediaInfo?.tmdbId, '22');
  assert.ok(doc.querySelectorAll('.seerr-card-badge').length > 0, 'and a badge appears without any hover');
});

test('a card carries its release year into the Rotten Tomatoes lookup', async t => {
  // The year decides the match: an exact title with no year can only be a
  // partial match, which is why every badge on a grid wore a "~". The observed
  // list entry knows the release date, so there is no reason to discard it.
  const fixture = createOverlay({ posters: true, linkless: true });
  t.after(() => (fixture.window.dispatchEvent(new fixture.window.Event('pagehide')), fixture.dom.window.close()));
  await settle();

  observe(fixture, [
    { id: 11, mediaType: 'movie', title: 'Low', posterPath: '/poster1.jpg', releaseDate: '2016-11-23' }
  ]);
  await new Promise(resolve => setTimeout(resolve, 300));
  await settle();

  const asked = fixture.messages.filter(message => message.action === 'getRottenTomatoesRatings');
  assert.ok(asked.length > 0, 'the card should have been looked up at all');
  assert.equal(asked[0].data.year, 2016, 'the year the page already knows must reach the lookup');
});

test('a message from another origin or channel is ignored', async t => {
  const fixture = createOverlay({ posters: true, linkless: true });
  t.after(() => (fixture.window.dispatchEvent(new fixture.window.Event('pagehide')), fixture.dom.window.close()));
  await settle();

  const item = { id: 99, mediaType: 'movie', title: 'Injected', posterPath: '/poster1.jpg' };
  send(fixture, { channel: 'something-else', url: '/api/v1/discover/movies', items: [item] });
  send(fixture, { channel: 'super-seerr:api', items: 'not-an-array' });
  send(fixture, { channel: 'super-seerr:api', url: '/api/v1/discover/movies', items: [null, 'bad', 42] });
  // Right shape, wrong origin.
  send(fixture, { channel: 'super-seerr:api', url: '/api/v1/discover/movies', items: [item] }, { origin: 'https://evil.example' });
  await settle();

  const cards = [...fixture.window.document.querySelectorAll('#grid > article')];
  assert.ok(cards.every(card => card.__seerrListMediaInfo?.tmdbId !== '99'), 'only our own channel and origin may identify cards');
});

// The page-world observer posts same-origin with source set to the window.
function send(fixture, data, { origin = 'https://seerr.example' } = {}) {
  const { window } = fixture;
  window.dispatchEvent(new window.MessageEvent('message', { data, origin, source: window }));
}

function observe(fixture, items, url = 'https://seerr.example/api/v1/discover/movies') {
  send(fixture, { channel: 'super-seerr:api', url, items });
}

test('every filter label stays attached to its own input', async t => {
  // The bar wraps, and label and input were separate flex items, so at narrow
  // widths a label could end one line with its input starting the next.
  const fixture = createOverlay(); t.after(() => (fixture.window.dispatchEvent(new fixture.window.Event('pagehide')), fixture.dom.window.close()));
  await settle();

  const bar = fixture.window.document.querySelector('#seerr-filter-bar');
  assert.ok(bar, 'the filter bar should exist');

  const inputs = [...bar.querySelectorAll('input[type="number"]')];
  assert.equal(inputs.length, 4, 'critics, audience, TMDB and IMDb');

  for (const input of inputs) {
    const field = input.closest('.seerr-filter-field');
    assert.ok(field, `${input.className} should sit in a field group`);
    assert.ok(field.querySelector('label'), `${input.className} should be grouped with its label`);
    assert.equal(field.querySelectorAll('input').length, 1, 'one input per group, so groups cannot split');
  }
});

test('the sort control is not left to collapse to an unreadable width', async t => {
  const fixture = createOverlay(); t.after(() => (fixture.window.dispatchEvent(new fixture.window.Event('pagehide')), fixture.dom.window.close()));
  await settle();

  const css = require('node:fs').readFileSync('src/content/seerr-overlay.css', 'utf8');
  const select = fixture.window.document.querySelector('.seerr-sort-select');
  assert.ok(select, 'the sort control should exist');
  assert.match(css, /\.seerr-sort-select\s*\{[^}]*min-width/, 'it should carry a minimum width');
  assert.match(css, /\.seerr-filter-field\s*\{[^}]*white-space:\s*nowrap/, 'field groups should not break internally');
  // The sort pair wraps like any other, so it is grouped too.
  const sortField = select.closest('.seerr-filter-field');
  assert.ok(sortField, 'the sort control should sit in a field group');
  assert.ok(sortField.querySelector('label'), 'grouped with its own label');
});

test('a live filter marks itself, and clears when reset', async t => {
  // The bar otherwise gives no sign of which thresholds are narrowing the grid.
  const fixture = createOverlay(); t.after(() => (fixture.window.dispatchEvent(new fixture.window.Event('pagehide')), fixture.dom.window.close()));
  await settle();
  const doc = fixture.window.document;

  const field = input => input.closest('.seerr-filter-field');
  const critics = doc.querySelector('.seerr-min-critics');
  const imdb = doc.querySelector('.seerr-min-imdb');

  assert.equal(field(critics).classList.contains('is-active'), false, 'nothing is set yet');

  critics.value = '75';
  critics.dispatchEvent(new fixture.window.Event('input', { bubbles: true }));
  await settle();

  assert.equal(field(critics).classList.contains('is-active'), true, 'a set threshold is marked');
  assert.equal(field(imdb).classList.contains('is-active'), false, 'an unset one is not');
  assert.equal(field(critics).dataset.score, 'critics', 'each field names the score it filters');

  doc.querySelector('.seerr-reset-sort').click();
  await settle();
  assert.equal(field(critics).classList.contains('is-active'), false, 'Reset clears the marking too');
});

test('every filter field declares which score it belongs to', async t => {
  const fixture = createOverlay(); t.after(() => (fixture.window.dispatchEvent(new fixture.window.Event('pagehide')), fixture.dom.window.close()));
  await settle();

  const scores = [...fixture.window.document.querySelectorAll('.seerr-filter-field[data-score]')]
    .map(field => field.dataset.score).sort();
  assert.deepEqual(scores, ['audience', 'critics', 'imdb', 'tmdb']);

  const css = require('node:fs').readFileSync('src/content/seerr-overlay.css', 'utf8');
  for (const score of scores) {
    assert.ok(css.includes(`[data-score="${score}"]`), `${score} should have its own accent`);
  }
});

test('a card badge keeps the edge and shadow that make it readable on any poster', async t => {
  // Posters run from near-white to near-black, so a dark fill alone vanishes
  // against a dark one. The light border and shadow are what carry it.
  const css = require('node:fs').readFileSync('src/content/seerr-overlay.css', 'utf8');
  const rule = css.slice(css.indexOf('.seerr-card-badge {'), css.indexOf('}', css.indexOf('.seerr-card-badge {')));

  assert.match(rule, /border:\s*1px solid rgba\(255, 255, 255/, 'a light edge, for dark posters');
  assert.match(rule, /box-shadow:/, 'a shadow, for light posters');
  assert.ok(!/^\s*opacity:/m.test(rule), 'no blanket opacity weakening it further');

  const fixture = createOverlay(); t.after(() => (fixture.window.dispatchEvent(new fixture.window.Event('pagehide')), fixture.dom.window.close()));
  await settle();
  const badge = fixture.window.document.querySelector('.seerr-card-badge');
  assert.ok(badge, 'badges should still render');
});

test('the stacked badge offset lives with the styles that determine it', async t => {
  const fixture = createOverlay(); t.after(() => (fixture.window.dispatchEvent(new fixture.window.Event('pagehide')), fixture.dom.window.close()));
  await settle();

  const source = require('node:fs').readFileSync('src/content/seerr-integration.js', 'utf8');
  assert.ok(!source.includes("style.top = '28px'"), 'no magic offset in the script');

  const upper = fixture.window.document.querySelector('.seerr-card-badge-upper');
  if (upper) assert.ok(upper.classList.contains('seerr-card-badge'), 'it is still a badge');
  // Comments stripped first: prose explaining an anchor can contain "bottom:"
  // and satisfy these on its own, which is exactly how the first version of
  // this assertion passed against a rule that said top.
  const css = require('node:fs').readFileSync('src/content/seerr-overlay.css', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\.seerr-card-badge-upper\s*\{[^}]*bottom:/, 'the offset is defined in CSS');
  assert.match(css, /\.seerr-card-badge\s*\{[^}]*bottom:/, 'and the badge itself sits at the bottom');
});

test('the bulk bar does not break its labels across lines', () => {
  const css = require('node:fs').readFileSync('src/content/seerr-overlay.css', 'utf8');
  const rule = css.slice(css.indexOf('.seerr-bulk-action-bar {'), css.indexOf('}', css.indexOf('.seerr-bulk-action-bar {')));
  assert.match(rule, /white-space:\s*nowrap/, '"3 selected" and "Review & Request" were wrapping');
});

test('selection is not signalled by colour alone', async t => {
  // A filled square and an empty one differ only in fill, which anyone who
  // cannot distinguish the two colours has no way to read.
  const css = require('node:fs').readFileSync('src/content/seerr-overlay.css', 'utf8');
  assert.match(css, /\.seerr-select-checkbox\.checked::after\s*\{[^}]*content:/,
    'the checked state should carry a mark, not just a fill');

  const fixture = createOverlay(); t.after(() => (fixture.window.dispatchEvent(new fixture.window.Event('pagehide')), fixture.dom.window.close()));
  await settle();
  const doc = fixture.window.document;
  doc.querySelector('.seerr-toggle-select').click();
  const box = doc.querySelector('.seerr-select-checkbox');
  assert.equal(box.getAttribute('aria-checked'), 'false');
  box.click();
  assert.equal(box.getAttribute('aria-checked'), 'true', 'and the state is exposed to assistive tech');
  assert.ok(box.classList.contains('checked'));
});

test('the diagnostic report survives the postMessage that carries it', async t => {
  // diagnose() runs in the isolated world and its report reaches the page
  // through postMessage, which structure-clones. sampleCards used to include
  // getCardMediaInfo() whole, and that holds the anchor element it matched on,
  // so the clone threw DataCloneError: an uncaught error in the content script,
  // and a caller left to time out blaming an overlay that was running fine.
  const fixture = createOverlay();
  t.after(() => (fixture.window.dispatchEvent(new fixture.window.Event('pagehide')), fixture.dom.window.close()));
  await settle();

  const report = fixture.window.seerr_debug.ratings.diagnose();
  assert.ok(report.sampleCards.length > 0, 'there must be a card to report on');
  assert.ok(report.sampleCards.some(card => card.media?.tmdbId), 'and it must still carry its identity');

  // structuredClone is not a faithful stand-in here: jsdom's elements are
  // ordinary objects that Node will happily clone, so the bug survives it. The
  // invariant that actually matters is that no DOM node appears in the report.
  const { Element } = fixture.window;
  const findElement = (value, path = 'report') => {
    if (value instanceof Element) return path;
    if (!value || typeof value !== 'object') return null;
    for (const [key, child] of Object.entries(value)) {
      const found = findElement(child, `${path}.${key}`);
      if (found) return found;
    }
    return null;
  };

  assert.equal(findElement(report), null, 'a DOM node in the report cannot cross postMessage');
});

// Sorting can only order what is rendered, so a grid scrolled a third of the
// way through sorts a third of the results. These cover pulling the rest in.

// Seerr adds cards only when a real scroll event lands near the bottom, so the
// fixture grows the grid on scrollTo exactly as Seerr's pagination would.
// The harness evaluates RatingsConfig inside the jsdom window, so the overlay
// reads that copy and not the one this file requires. Tuning must go through
// the window, or it changes nothing and the run uses the shipped values.
function tune(fixture, values) {
  const config = fixture.window.RatingsConfig;
  assert.ok(config, 'the overlay must expose the config this tunes');
  Object.assign(config, values);
}

// Detecting the end of the list means waiting out bulkLoadWaitMs, so the tests
// shorten it rather than spending four seconds each.
function withFastPaging(fixture, ms = 250) {
  tune(fixture, { bulkLoadWaitMs: ms });
}

function paginate(fixture, { pages = 3, perPage = 2 } = {}) {
  const { window } = fixture;
  const grid = window.document.getElementById('grid');
  // jsdom lays nothing out, so scrollHeight is 0 and "scroll to the bottom"
  // would be indistinguishable from restoring the reader to the top.
  Object.defineProperty(window.document.documentElement, 'scrollHeight', { value: 5000, configurable: true });
  let served = 0;
  const scrolls = [];
  window.scrollTo = (x, y) => {
    scrolls.push([x, y]);
    // Only a scroll toward the bottom pages; restoring position must not.
    if (y === 0 || served >= pages) return;
    served++;
    for (let i = 0; i < perPage; i++) {
      const id = 100 + served * 10 + i;
      grid.insertAdjacentHTML('beforeend',
        `<article data-testid="title-card" data-id="${id}"><a href="/movie/${id}"><h2>Extra ${id}</h2></a></article>`);
    }
  };
  return { scrolls, cards: () => window.document.querySelectorAll('[data-testid="title-card"]').length };
}

test('loading the rest of the grid scrolls until the list runs out', { timeout: 20000 }, async t => {
  const fixture = createOverlay();
  t.after(() => (fixture.window.dispatchEvent(new fixture.window.Event('pagehide')), fixture.dom.window.close()));
  await settle();
  withFastPaging(fixture);
  const page = paginate(fixture, { pages: 3, perPage: 2 });
  const before = page.cards();

  const added = await fixture.window.testOverlay.loadMoreCards({ cancelled: false }, () => {});

  assert.equal(added, 6, 'three pages of two');
  assert.equal(page.cards(), before + 6);
  // A scroll that adds nothing is how the end of the list is detected, and the
  // reader is put back where they were rather than left at the bottom.
  assert.deepEqual(page.scrolls.at(-1), [0, 0], 'the scroll position is restored');
});

test('loading stops at the configured target rather than running forever', { timeout: 20000 }, async t => {
  const fixture = createOverlay();
  t.after(() => (fixture.window.dispatchEvent(new fixture.window.Event('pagehide')), fixture.dom.window.close()));
  await settle();
  withFastPaging(fixture);
  const page = paginate(fixture, { pages: 1000, perPage: 2 });

  tune(fixture, { bulkLoadTarget: 5 });

  const added = await fixture.window.testOverlay.loadMoreCards({ cancelled: false }, () => {});

  assert.ok(added >= 5 && added <= 6, `expected to stop around the target, added ${added}`);
  assert.ok(page.cards() < 100, 'a thousand available pages must not all be pulled in');
});

test('cancelling stops the run instead of finishing it', { timeout: 20000 }, async t => {
  const fixture = createOverlay();
  t.after(() => (fixture.window.dispatchEvent(new fixture.window.Event('pagehide')), fixture.dom.window.close()));
  await settle();
  withFastPaging(fixture);
  const page = paginate(fixture, { pages: 1000, perPage: 2 });

  const run = { cancelled: false };
  const loading = fixture.window.testOverlay.loadMoreCards(run, added => { if (added >= 2) run.cancelled = true; });
  const added = await loading;

  assert.ok(added <= 4, `a cancelled run must stop promptly, added ${added}`);
  assert.ok(page.cards() < 1000, 'and nowhere near the whole list');
});

test('scoring the grid resolves the cards that lazy loading left unscored', { timeout: 20000 }, async t => {
  // The point of the button: after it runs, sorting and the score filters
  // operate over the whole grid rather than the part that happened to resolve.
  const fixture = createOverlay();
  t.after(() => (fixture.window.dispatchEvent(new fixture.window.Event('pagehide')), fixture.dom.window.close()));
  await settle();
  withFastPaging(fixture);
  paginate(fixture, { pages: 2, perPage: 3 });
  await fixture.window.testOverlay.loadMoreCards({ cancelled: false }, () => {});

  const unscored = () => [...fixture.window.document.querySelectorAll('[data-testid="title-card"]')]
    .filter(card => !card.querySelector('[class*="card-badge"]')).length;
  const before = unscored();
  assert.ok(before > 0, 'the newly loaded cards start without scores');

  const progress = [];
  const done = await fixture.window.testOverlay.scoreAllCards({ cancelled: false }, (...args) => progress.push(args));
  await settle();

  assert.equal(done, before, 'every unscored card is resolved, not just the visible ones');
  assert.ok(progress.length > 0, 'and the run reports what it is doing');
  assert.equal(progress.at(-1)[1], before, 'against the full total, so the label cannot mislead');
});

test('cancelling during scoring stops the remaining batches', { timeout: 20000 }, async t => {
  // Scoring five hundred titles takes minutes, so stopping has to take effect
  // between batches rather than at the end of the run.
  const fixture = createOverlay();
  t.after(() => (fixture.window.dispatchEvent(new fixture.window.Event('pagehide')), fixture.dom.window.close()));
  await settle();
  withFastPaging(fixture);
  paginate(fixture, { pages: 4, perPage: 5 });
  await fixture.window.testOverlay.loadMoreCards({ cancelled: false }, () => {});

  const unscored = [...fixture.window.document.querySelectorAll('[data-testid="title-card"]')]
    .filter(card => !card.querySelector('[class*="card-badge"]')).length;
  assert.ok(unscored > fixture.window.RatingsConfig.bulkScoreBatch * 2, 'there must be several batches to stop');

  const run = { cancelled: false };
  const done = await fixture.window.testOverlay.scoreAllCards(run, () => { run.cancelled = true; });

  assert.equal(done, fixture.window.RatingsConfig.bulkScoreBatch, 'it stops after the batch that cancelled it');
  assert.ok(done < unscored, 'leaving the rest untouched');
});

test('a pair of badges reads critics above audience, clear of the status tick', async t => {
  // Seerr puts its own status badge — the green tick on an available title — at
  // the top right, which our badge used to cover. Anchored to the bottom now,
  // the second badge sits above the first, so the offset has to move to the
  // critics badge or the pair reads upside down against the detail row.
  const fixture = createOverlay({ audience: true });
  t.after(() => (fixture.window.dispatchEvent(new fixture.window.Event('pagehide')), fixture.dom.window.close()));
  await settle();
  await new Promise(resolve => setTimeout(resolve, 300));
  await settle();

  const card = [...fixture.window.document.querySelectorAll('[data-testid="title-card"]')]
    .find(candidate => candidate.querySelector('.seerr-card-audience-badge'));
  assert.ok(card, 'a card should carry both scores');

  const critics = card.querySelector('.seerr-card-badge:not(.seerr-card-audience-badge)');
  const audienceBadge = card.querySelector('.seerr-card-audience-badge');
  assert.ok(critics.classList.contains('seerr-card-badge-upper'), 'critics sits above');
  assert.ok(!audienceBadge.classList.contains('seerr-card-badge-upper'), 'audience stays at the bottom');
});

test('a lone badge is not offset as though something sat beneath it', async t => {
  const fixture = createOverlay();
  t.after(() => (fixture.window.dispatchEvent(new fixture.window.Event('pagehide')), fixture.dom.window.close()));
  await settle();
  await new Promise(resolve => setTimeout(resolve, 300));
  await settle();

  const badges = [...fixture.window.document.querySelectorAll('.seerr-card-badge')];
  assert.ok(badges.length > 0, 'there should be badges to check');
  assert.ok(badges.every(badge => !badge.classList.contains('seerr-card-badge-upper')),
    'with nothing below it, a single badge stays on the bottom edge');
});

test('a scored card is marked so the scores can step aside while it is hovered', async t => {
  // Hovering an unavailable title grows a full-width Request button along the
  // same bottom edge the badges now sit on. jsdom cannot evaluate :hover, so
  // this covers the half that is behaviour — the marker the rule hangs on —
  // and checks the rule itself is present and aimed at that marker.
  const fixture = createOverlay();
  t.after(() => (fixture.window.dispatchEvent(new fixture.window.Event('pagehide')), fixture.dom.window.close()));
  await settle();
  await new Promise(resolve => setTimeout(resolve, 300));
  await settle();

  const badge = fixture.window.document.querySelector('.seerr-card-badge');
  assert.ok(badge, 'there should be a badge to hide');
  assert.ok(badge.closest('.seerr-scored-card'), 'its card carries the marker');

  // Comments stripped: prose about hovering would otherwise satisfy this.
  const css = require('node:fs').readFileSync('src/content/seerr-overlay.css', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  // The terminator matters: /opacity:\s*0/ alone is satisfied by "opacity: 0.5".
  assert.match(css, /\.seerr-scored-card:hover\s+\.seerr-card-badge\s*\{[^}]*opacity:\s*0\s*;/,
    'the rule hides the scores rather than merely dimming them');
});

test('each card explains its score and supports a scoped retry', async t => {
  const fixture = createOverlay(); t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.window.close(); });
  await settle();
  const cards = [...fixture.window.document.querySelectorAll('[data-testid="title-card"]')];
  assert.equal(fixture.window.document.querySelectorAll('.seerr-rating-details').length, 3);
  const details = cards[0].querySelector('.seerr-rating-details');
  assert.match(details.textContent, /Source:.*Last checked:/);
  const before = fixture.messages.filter(message => message.action === 'getRottenTomatoesRatings').length;
  details.querySelector('button').click(); await settle();
  const after = fixture.messages.filter(message => message.action === 'getRottenTomatoesRatings');
  assert.equal(after.length, before + 1);
  assert.equal(after.at(-1).data.title, 'Low');
  assert.equal(after.at(-1).data.refresh, true);
  assert.equal(fixture.window.document.querySelectorAll('.seerr-rating-details').length, 3);
});

test('filter presets persist, apply sorting and thresholds, and delete', async t => {
  const fixture = createOverlay(); t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.window.close(); });
  await settle();
  const { document: doc, Event } = fixture.window;
  const sort = doc.querySelector('.seerr-sort-select');
  sort.value = 'rt-critics-desc'; sort.dispatchEvent(new Event('change'));
  const min = doc.querySelector('.seerr-min-critics'); min.value = '70'; min.dispatchEvent(new Event('input'));
  const controls = doc.querySelector('.seerr-filter-presets');
  controls.querySelector('input').value = 'Movie night';
  controls.querySelector('button').click(); await settle();
  assert.equal(fixture.storage.seerrFilterPresetsV1[0].name, 'Movie night');
  assert.equal(fixture.storage.seerrFilterPresetsV1[0].filters.minCritics, 70);
  doc.querySelector('.seerr-reset-sort').click();
  const select = controls.querySelector('select'); select.value = 'Movie night'; select.dispatchEvent(new Event('change'));
  assert.equal(sort.value, 'rt-critics-desc'); assert.equal(min.value, '70');
  assert.equal(doc.querySelector('[data-id="1"]').style.display, 'none');
  assert.equal(doc.querySelector('[data-id="2"]').style.display, '');
  controls.querySelectorAll('button')[1].click(); await settle();
  assert.equal(fixture.storage.seerrFilterPresetsV1.length, 0);
});


test('bulk TV review requires season selection and sends only the reviewed seasons', async t => {
  const fixture = createOverlay({ tv: true });
  t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.window.close(); });
  await settle();
  const doc = fixture.window.document;
  const original = fixture.window.chrome.runtime.sendMessage;
  const writes = [];
  let finishRequest;
  fixture.window.chrome.runtime.sendMessage = async message => {
    if (message.action === 'getSeasonOptions') return { success: true, data: {
      title: 'Low', tmdbId: 1, server: 'https://seerr.example', seasons: [
        { number: 1, name: 'Season 1', episodeCount: 10, availability: 'Available', requestable: false },
        { number: 2, name: 'Season 2', episodeCount: 10, availability: 'Not available', requestable: true }
      ]
    } };
    if (message.action === 'requestMedia') { writes.push(message.data); return new Promise(resolve => { finishRequest = resolve; }); }
    return original(message);
  };
  doc.querySelector('.seerr-toggle-select').click();
  doc.querySelector('.seerr-select-checkbox').click();
  doc.querySelector('.seerr-bulk-review').click();
  const bulk = doc.querySelector('.seerr-confirmation-modal');
  assert.equal(bulk.querySelector('.confirm-btn').disabled, true);
  bulk.querySelector('[data-season-index]').click(); await settle();
  const picker = doc.querySelector('.seerr-season-picker');
  assert.match(picker.textContent, /Season 1.*Available/);
  picker.querySelector('input[value="2"]').click();
  [...picker.querySelectorAll('button')].find(button => button.textContent === 'Use selected seasons').click();
  await settle();
  assert.equal(writes.length, 0);
  assert.equal(bulk.querySelector('.confirm-btn').disabled, false);
  bulk.querySelector('.confirm-btn').click(); await settle();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].mediaType, 'tv');
  assert.deepEqual(Array.from(writes[0].seasons), [2]);
  assert.equal(bulk.querySelector('[data-season-index]').disabled, true);
  finishRequest({ success: true }); await settle();
});

test('manual refresh keeps known scores visible and retains them when sources fail', async t => {
  const f = createOverlay(); t.after(() => { f.window.dispatchEvent(new f.window.Event('pagehide')); f.window.close(); });
  await settle();
  const doc = f.window.document;
  const before = doc.querySelector('[data-id="1"] .seerr-card-badge').textContent;
  let release;
  // Every request shares one externally released failure, so the refresh can finish.
  const waiting = new Promise(resolve => { release = resolve; });
  f.window.chrome.runtime.sendMessage = async () => { await waiting; return { success: false }; };
  f.window.fetch = async () => { throw new Error('Offline'); };
  doc.querySelector('.seerr-refresh-scores').click(); await settle();
  assert.equal(doc.querySelector('[data-id="1"] .seerr-card-badge').textContent, before);
  release(); await settle();
  assert.equal(doc.querySelector('[data-id="1"] .seerr-card-badge').textContent, before);
  assert.equal(doc.querySelector('.seerr-refresh-scores').disabled, false);
});

test('manual refresh preserves release years and cancels queued work on navigation', async t => {
  const f = createOverlay(); t.after(() => { f.window.dispatchEvent(new f.window.Event('pagehide')); f.window.close(); });
  await settle();
  const doc = f.window.document, grid = doc.getElementById('grid');
  for (let id = 4; id <= 10; id++) {
    const card = doc.querySelector('article').cloneNode(true);
    card.dataset.id = String(id); card.querySelector('a').href = `/movie/${id}`;
    card.querySelector('h2').textContent = `Film ${id}`; grid.appendChild(card);
  }
  for (const card of grid.querySelectorAll('article')) {
    card.__seerrMediaInfo = { tmdbId: Number(card.dataset.id), title: 'Film', year: 1999, mediaType: 'movie' };
  }
  let started = 0; const release = [];
  f.window.chrome.runtime.sendMessage = async message => {
    if (message.action !== 'getRottenTomatoesRatings') return { success: true };
    assert.equal(message.data.year, 1999); started++;
    return new Promise(resolve => release.push(() => resolve({ success: false })));
  };
  doc.querySelector('.seerr-refresh-scores').click(); await settle();
  assert.equal(started, 4);
  f.window.history.replaceState({}, '', '/settings');
  f.window.testOverlay.handleRouteChange();
  release.forEach(done => done()); await settle();
  assert.equal(started, 4);
});

test('navigating during loading stops scrolling and never restores the old page position', async t => {
  const f = createOverlay(); t.after(() => { f.window.dispatchEvent(new f.window.Event('pagehide')); f.window.close(); });
  await settle(); withFastPaging(f);
  const scrolls = [];
  f.window.scrollTo = (...args) => scrolls.push(args);
  const loading = f.window.testOverlay.loadMoreCards({ cancelled: false }, () => assert.fail('obsolete progress'));
  assert.equal(scrolls.length, 1);
  f.window.history.replaceState({}, '', '/settings'); f.window.testOverlay.handleRouteChange();
  assert.equal(await loading, 0);
  assert.equal(scrolls.length, 1, 'no scroll restoration on the new page');
});

test('page exit cancels the active Load more button run and permits a fresh run on return', async t => {
  const f = createOverlay(); t.after(() => { f.window.dispatchEvent(new f.window.Event('pagehide')); f.window.close(); });
  await settle(); withFastPaging(f);
  const scrolls = []; f.window.scrollTo = (...args) => scrolls.push(args);
  const button = f.window.document.querySelector('.seerr-load-all');
  button.click(); assert.equal(scrolls.length, 1);
  f.window.dispatchEvent(new f.window.Event('pagehide'));
  f.window.dispatchEvent(new f.window.Event('pageshow'));
  button.click(); assert.equal(scrolls.length, 2, 'starts a new run instead of stopping the abandoned run');
  await new Promise(resolve => setTimeout(resolve, 180));
  // The old run finishing must not clear the newer run's ownership or label.
  assert.equal(button.textContent, 'Loading…');
  button.click(); assert.match(button.textContent, /Stopping/);
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.equal(scrolls.length, 3, 'only the current run restores its position');
});

for (const [outcomes, kind, heading] of [
  [[false], 'error', 'Bulk Request Failed'],
  [[true, false], 'warning', 'Some Requests Failed'],
  [[true], 'success', 'Bulk Request Complete']
]) {
  test(`bulk request reports ${kind} for ${outcomes.join(',')}`, async t => {
    const f = createOverlay(); t.after(() => { f.window.dispatchEvent(new f.window.Event('pagehide')); f.window.close(); });
    await settle(); const doc = f.window.document;
    doc.querySelector('.seerr-toggle-select').click();
    const boxes = doc.querySelectorAll('.seerr-select-checkbox');
    outcomes.forEach((_, i) => boxes[i].click());
    doc.querySelector('.seerr-bulk-review').click();
    let sent = 0;
    const original = f.window.chrome.runtime.sendMessage;
    f.window.chrome.runtime.sendMessage = async message => message.action === 'requestMedia' ? { success: outcomes[sent++] } : original(message);
    doc.querySelector('.confirm-btn').click();
    await new Promise(resolve => setTimeout(resolve, outcomes.length > 1 ? 550 : 0)); await settle();
    const note = doc.querySelector('.seerr-notification');
    assert.equal(note.classList.contains(kind), true);
    assert.equal(note.querySelector('.seerr-notification-title').textContent, heading);
    assert.equal(note.getAttribute('role'), kind === 'error' ? 'alert' : 'status');
    assert.equal(sent, outcomes.length);
  });
}

test('selection follows added and removed cards and disables empty review', async t => {
  const f = createOverlay(); t.after(() => { f.window.dispatchEvent(new f.window.Event('pagehide')); f.window.close(); });
  await settle(); const doc = f.window.document;
  doc.querySelector('.seerr-toggle-select').click();
  const review = doc.querySelector('.seerr-bulk-review'); assert.equal(review.disabled, true);
  const card = doc.createElement('article'); card.setAttribute('data-testid', 'title-card');
  card.innerHTML = '<a href="/movie/99"><h2>New arrival</h2></a>'; doc.getElementById('grid').appendChild(card);
  f.window.testOverlay.injectCardBadges(); await settle();
  const checkbox = card.querySelector('.seerr-select-checkbox'); assert.ok(checkbox);
  checkbox.click(); assert.equal(review.disabled, false);
  card.remove(); f.window.testOverlay.injectCardBadges(); await settle();
  assert.equal(review.disabled, true); assert.match(doc.querySelector('.seerr-bulk-count').textContent, /0 selected/);
});

test('duplicate cards produce one request and completion restores selection controls', async t => {
  const f = createOverlay(); t.after(() => { f.window.dispatchEvent(new f.window.Event('pagehide')); f.window.close(); });
  await settle(); const doc = f.window.document;
  const card = doc.createElement('article'); card.setAttribute('data-testid', 'title-card');
  card.innerHTML = '<a href="/movie/1"><h2>Low</h2></a>'; doc.getElementById('grid').appendChild(card);
  doc.querySelector('.seerr-toggle-select').click();
  doc.querySelector('[data-id="1"] .seerr-select-checkbox').click(); card.querySelector('.seerr-select-checkbox').click();
  doc.querySelector('.seerr-bulk-review').click();
  assert.equal(doc.querySelector('.confirm-btn').textContent, 'Request 1 title');
  const original = f.window.chrome.runtime.sendMessage; let writes = 0;
  f.window.chrome.runtime.sendMessage = async message => { if (message.action === 'requestMedia') { writes++; return { success: true }; } return original(message); };
  doc.querySelector('.confirm-btn').click(); await settle();
  assert.equal(writes, 1); assert.equal(doc.querySelectorAll('.seerr-select-checkbox').length, 0);
  assert.equal(doc.querySelector('.seerr-toggle-select').textContent, 'Select titles');
  assert.equal(doc.activeElement, doc.querySelector('.seerr-toggle-select'));
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const source = file => fs.readFileSync(file, 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let i = 0; i < 12; i++) await flush(); }

function createOverlay({ settings = {}, path = '/search?query=test', embedded = null, listItems = [], linkless = false, wrapped = false, posters = false } = {}) {
  const dom = new JSDOM(`<main><div id="grid">${['Low', 'High', 'Unknown'].map((title, index) => `<article data-testid="title-card" data-id="${index + 1}"><a href="/movie/${index + 1}"><h2>${title}</h2></a></article>`).join('')}</div></main>`, { url: `https://seerr.example${path}`, runScripts: 'outside-only' });
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
      sync: { get: async () => syncedStorage() },
      // MV3 always provides these; a mock without them fails code that is fine.
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      onChanged: { addListener(fn) { storageListener = fn; } }
    },
    runtime: { sendMessage: async message => {
      messages.push(message);
      if (message.action === 'getConfigState') {
        return { success: true, data: { apiConfigured: !!storage.seerrApiKey, serverUrl: storage.seerrUrl ?? null } };
      }
      return { success: true, data: message.action === 'getRottenTomatoesRatings' ? { rtCriticsScore: { Low: 30, High: 95 }[message.data.title] ?? null, confidence: 0.9 } : {} };
    } }
  };
  window.fetch = async url => { urls.push(url); return { ok: true, json: async () => ({ results: url.includes('/search?') ? listItems : [] }) }; };
  if (embedded) {
    const script = window.document.createElement('script');
    script.type = 'application/json';
    script.textContent = JSON.stringify(embedded);
    window.document.head.append(script);
  }
  for (const file of ['RatingsModel', 'RatingsConfig']) window.eval(source(`src/shared/${file}.js`));
  window.eval(source('src/content/seerr-integration.js').replace(/\}\)\(\);\s*$/, `window.testOverlay = { injectCardBadges, injectSortFilterControls, handleRouteChange, extractSeerrNativeRatings }; })();`));
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
  fixture.window.chrome.runtime.sendMessage = () => { requests++; return new Promise(resolve => { release = resolve; }); };
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

  const stacked = fixture.window.document.querySelector('.seerr-card-badge-stacked');
  if (stacked) assert.ok(stacked.classList.contains('seerr-card-badge'), 'it is still a badge');
  const css = require('node:fs').readFileSync('src/content/seerr-overlay.css', 'utf8');
  assert.match(css, /\.seerr-card-badge-stacked\s*\{[^}]*top:/, 'the offset is defined in CSS');
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

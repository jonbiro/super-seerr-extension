const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const source = file => fs.readFileSync(file, 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let i = 0; i < 12; i++) await flush(); }

function createOverlay({ settings = {}, path = '/search?query=test', embedded = null, listItems = [], linkless = false, wrapped = false } = {}) {
  const dom = new JSDOM(`<main><div id="grid">${['Low', 'High', 'Unknown'].map((title, index) => `<article data-testid="title-card" data-id="${index + 1}"><a href="/movie/${index + 1}"><h2>${title}</h2></a></article>`).join('')}</div></main>`, { url: `https://seerr.example${path}`, runScripts: 'outside-only' });
  const { window } = dom;
  if (wrapped) window.document.querySelectorAll('[data-testid="title-card"]').forEach(card => {
    const item = window.document.createElement('li');
    card.replaceWith(item); item.append(card);
  });
  if (linkless) window.document.querySelectorAll('a').forEach(link => link.replaceWith(...link.childNodes));
  const storage = { seerrUrl: 'https://seerr.example', seerrApiKey: 'fixture', ...settings };
  let storageListener;
  const messages = [];
  const urls = [];
  window.chrome = {
    storage: { sync: { get: async () => storage }, onChanged: { addListener(fn) { storageListener = fn; } } },
    runtime: { sendMessage: async message => {
      messages.push(message);
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

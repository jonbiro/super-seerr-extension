const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

function setup(t, { title = 'Fight Club', year = 1999, url = 'https://www.imdb.com/title/tt0137523/', language = 'en-US', get = async () => ({}), set = async () => {} } = {}) {
  const dom = new JSDOM('<body></body>', { url, runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const { window } = dom;
  Object.defineProperty(window.navigator, 'language', { value: language });
  window.chrome = { storage: { sync: { get, set } } };
  window.eval(fs.readFileSync('src/shared/UIComponents.js', 'utf8'));
  window.eval('window.ui = new UIComponents();');
  const details = window.ui.createTitleExploration({ title, year, mediaType: 'movie' });
  if (details) window.document.body.appendChild(details);
  return { window, details, country: details?.querySelector('select'),
    links: details ? Object.fromEntries([...details.querySelectorAll('a')].map(link => [link.textContent, link])) : {} };
}

const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

test('discovery links encode title text inside fixed provider URLs and disclose searches', async t => {
  const title = '<img src=x onerror=alert(1)> & café? #1';
  const { details, links } = setup(t, { title });
  assert.equal(details.querySelector('img'), null);
  assert.equal(new URL(links['Search Trakt'].href).origin, 'https://app.trakt.tv');
  assert.equal(new URL(links['Search Trakt'].href).searchParams.get('q'), `${title} 1999`);
  assert.equal(new URL(links['Where to watch'].href).searchParams.get('q'), `${title} 1999`);
  assert.equal(links['Search Simkl'].href, 'https://simkl.com/search/');
  for (const link of Object.values(links)) {
    assert.equal(link.target, '_blank');
    assert.equal(link.rel, 'noopener noreferrer');
  }
  assert.match(details.textContent, /search pages in a new tab/);
});

test('country defaults follow the actual JustWatch page or a supported browser locale', async t => {
  const justwatch = setup(t, { url: 'https://br.justwatch.com/br/filme/clube-da-luta', language: 'en-GB' });
  assert.equal(justwatch.country.value, 'br');
  assert.equal(new URL(justwatch.links['Where to watch'].href).pathname, '/br/search');
  const localized = setup(t, { url: 'https://de.justwatch.com/de/film/fight-club', language: 'en-US' });
  assert.equal(localized.country.value, 'de');
  assert.equal(new URL(localized.links['Where to watch'].href).pathname, '/de/search');
  const british = setup(t, { language: 'en-GB' });
  assert.equal(british.country.value, 'uk');
  const spoof = setup(t, { url: 'https://justwatch.com.example/br/filme/example', language: 'en-US' });
  assert.equal(spoof.country.value, 'us');
});

test('saved country restores on a new flyout and untrusted preferences stay within the allowlist', async t => {
  const saved = setup(t, { get: async () => ({ justWatchCountry: 'de' }) });
  await settle();
  assert.equal(saved.country.value, 'de');
  assert.equal(new URL(saved.links['Where to watch'].href).pathname, '/de/search');
  for (const justWatchCountry of ['__proto__', 'https://evil.test', '../../evil', 'zz', 5]) {
    const page = setup(t, { get: async () => ({ justWatchCountry }) });
    await settle();
    assert.equal(page.country.value, 'us');
    assert.equal(new URL(page.links['Where to watch'].href).origin, 'https://www.justwatch.com');
  }
});

test('a late saved country cannot overwrite an explicit region selection', async t => {
  let resolveGet;
  const writes = [];
  const page = setup(t, { get: () => new Promise(resolve => { resolveGet = resolve; }), set: async value => writes.push(value) });
  page.country.value = 'fr';
  page.country.dispatchEvent(new page.window.Event('change'));
  resolveGet({ justWatchCountry: 'de' });
  await settle();
  assert.equal(page.country.value, 'fr');
  assert.equal(new URL(page.links['Where to watch'].href).pathname, '/fr/search');
  assert.equal(writes[0].justWatchCountry, 'fr');
});

test('storage failures leave exploration links and country selection usable', async t => {
  const page = setup(t, { get: async () => { throw new Error('unavailable'); }, set: async () => { throw new Error('unavailable'); } });
  await settle();
  page.country.value = 'jp';
  page.country.dispatchEvent(new page.window.Event('change'));
  await settle();
  assert.equal(new URL(page.links['Where to watch'].href).pathname, '/jp/search');
  assert.equal(page.country.disabled, false);
});

test('copy title uses an explicit click and reports denied clipboard access', async t => {
  const page = setup(t, { title: 'Amélie', year: 2001 });
  const copied = [];
  Object.defineProperty(page.window.navigator, 'clipboard', { configurable: true, value: { writeText: async text => copied.push(text) } });
  assert.deepEqual(copied, []);
  const button = page.details.querySelector('button');
  button.click();
  await settle();
  assert.deepEqual(copied, ['Amélie 2001']);
  assert.match(page.details.querySelector('[role="status"]').textContent, /Title copied/);
  Object.defineProperty(page.window.navigator, 'clipboard', { value: { writeText: async () => { throw new Error('denied'); } } });
  button.click();
  await settle();
  assert.match(page.details.querySelector('[role="status"]').textContent, /Could not copy/);
  assert.equal(button.disabled, false);
});

test('missing or invalid release years cannot add arbitrary query fragments', t => {
  for (const year of [null, '1999&evil=1', 17, Infinity]) {
    const { links } = setup(t, { title: '1917', year });
    assert.equal(new URL(links['Search Trakt'].href).searchParams.get('q'), '1917');
  }
  assert.equal(setup(t, { title: '' }).details, null);
});

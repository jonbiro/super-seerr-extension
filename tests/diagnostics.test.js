// Everything about identifying un-hovered cards is unverifiable from here, so
// diagnose() has to distinguish the ways it can fail on a real server.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setImmediate(r)); };

function seerrPage({ posters = ['/poster1.jpg', '/poster2.jpg'] } = {}) {
  const cards = posters.map((p, i) => `<article data-testid="title-card" data-id="${i + 1}"><div role="link"><img alt="" src="https://image.tmdb.org/t/p/w300${p}"></div></article>`).join('');
  const dom = new JSDOM(`<main><div id="grid">${cards}</div></main>`, { url: 'https://seerr.example/discover/movies', runScripts: 'outside-only' });
  const { window } = dom;
  window.chrome = {
    storage: { sync: { get: async () => ({ seerrUrl: 'https://seerr.example' }) }, local: { get: async () => ({}), set: async () => {}, remove: async () => {} }, onChanged: { addListener() {} } },
    runtime: { sendMessage: async () => ({ success: true, data: {} }) }
  };
  window.fetch = async () => ({ ok: true, json: async () => ({ results: [] }) });
  for (const f of ['RatingsModel', 'RatingsConfig']) window.eval(fs.readFileSync(`src/shared/${f}.js`, 'utf8'));
  window.eval(fs.readFileSync('src/content/seerr-integration.js', 'utf8'));
  return {
    dom, window,
    diagnose: () => window.seerr_debug.ratings.diagnose(),
    observe: items => window.dispatchEvent(new window.MessageEvent('message', {
      data: { channel: 'super-seerr:api', url: 'https://seerr.example/api/v1/discover/movies', items },
      origin: 'https://seerr.example',
      source: window
    }))
  };
}

test('a silent observer is reported as such', async t => {
  const page = seerrPage(); t.after(() => page.dom.window.close());
  await settle();

  const report = page.diagnose();
  assert.equal(report.observed.messages, 0, 'nothing has been forwarded');
  assert.equal(report.listItems, 0);
  assert.equal(report.unresolvedCards[0].reason, 'nothing observed from the page yet');
});

test('observed traffic is counted, by path', async t => {
  const page = seerrPage(); t.after(() => page.dom.window.close());
  await settle();

  page.observe([{ id: 11, mediaType: 'movie', title: 'A', posterPath: '/poster1.jpg' }]);
  await settle();

  const report = page.diagnose();
  assert.equal(report.observed.messages, 1);
  assert.equal(report.observed.items, 1);
  assert.equal(report.observed.byPath['/api/v1/discover/movies'], 1);
  assert.ok(report.observed.lastAt, 'the time of the last message is recorded');
});

test('a poster nothing matches is called out, not left silent', async t => {
  const page = seerrPage(); t.after(() => page.dom.window.close());
  await settle();

  // Observed traffic that covers a different title entirely.
  page.observe([{ id: 99, mediaType: 'movie', title: 'Elsewhere', posterPath: '/unrelated.jpg' }]);
  await settle();

  const report = page.diagnose();
  assert.ok(report.observed.items > 0, 'the observer did speak');
  const unresolved = report.unresolvedCards.find(card => card.posterUrl?.includes('poster1'));
  assert.equal(unresolved.reason, 'no observed title has this poster');
  assert.equal(unresolved.posterMatches, 0);
  assert.equal(unresolved.hasMediaLink, false, 'and Seerr has not mounted the link');
});

test('an ambiguous poster is distinguished from an absent one', async t => {
  const page = seerrPage(); t.after(() => page.dom.window.close());
  await settle();

  // Two titles claiming the same poster: resolving would be a guess.
  page.observe([
    { id: 11, mediaType: 'movie', title: 'A', posterPath: '/poster1.jpg' },
    { id: 12, mediaType: 'movie', title: 'B', posterPath: '/poster1.jpg' }
  ]);
  await settle();

  const unresolved = page.diagnose().unresolvedCards.find(card => card.posterUrl?.includes('poster1'));
  assert.equal(unresolved.reason, 'more than one observed title has this poster');
  assert.equal(unresolved.posterMatches, 2);
});

test('a resolved page reports no unresolved cards', async t => {
  const page = seerrPage(); t.after(() => page.dom.window.close());
  await settle();

  page.observe([
    { id: 11, mediaType: 'movie', title: 'A', posterPath: '/poster1.jpg' },
    { id: 22, mediaType: 'movie', title: 'B', posterPath: '/poster2.jpg' }
  ]);
  await settle();

  const report = page.diagnose();
  // Length, not deepEqual: the array comes from the page realm.
  assert.equal(report.unresolvedCards.length, 0, `still unresolved: ${JSON.stringify(report.unresolvedCards)}`);
  assert.equal(report.cardCount, 2);
});

test('a malformed message is counted rather than silently dropped', async t => {
  const page = seerrPage(); t.after(() => page.dom.window.close());
  await settle();

  page.window.dispatchEvent(new page.window.MessageEvent('message', {
    data: { channel: 'super-seerr:api', items: 'not-an-array' },
    origin: 'https://seerr.example',
    source: page.window
  }));
  await settle();

  const report = page.diagnose();
  assert.equal(report.observed.messages, 0);
  assert.ok(report.observed.rejected >= 1, 'a rejected message should be visible in the report');
});

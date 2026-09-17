// A year is what separates a film from its own remake. Seerr withholds it on
// an un-hovered card, so it has to arrive from the observed list data — and
// without it the lookup cannot tell 2016's Moana from the live-action one.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

// Badge injection is coalesced behind a short timer, so microtasks alone are
// not enough to see the lookups it issues.
const settle = async () => {
  for (let i = 0; i < 16; i++) await new Promise(r => setImmediate(r));
  await new Promise(r => setTimeout(r, 300));
  for (let i = 0; i < 16; i++) await new Promise(r => setImmediate(r));
};

function grid(items) {
  const cards = items.map((it, i) =>
    `<article data-testid="title-card" data-id="${i + 1}"><div role="link"><img alt="" src="https://image.tmdb.org/t/p/w300${it.posterPath}"></div></article>`).join('');
  const dom = new JSDOM(`<main><div id="grid">${cards}</div></main>`,
    { url: 'https://seerr.example/discover/movies', runScripts: 'outside-only' });
  const { window } = dom;
  const sent = [];
  window.chrome = {
    storage: { sync: { get: async () => ({ seerrUrl: 'https://seerr.example' }) },
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} }, onChanged: { addListener() {} } },
    runtime: { sendMessage: async m => { sent.push(m);
      return m.action === 'getConfigState' ? { success: true, data: { apiConfigured: false } }
        : { success: true, data: { rtCriticsScore: 95, confidence: 1 } }; } }
  };
  window.fetch = async () => ({ ok: true, json: async () => ({ results: [] }) });
  for (const f of ['RatingsModel', 'RatingsConfig']) window.eval(fs.readFileSync(`src/shared/${f}.js`, 'utf8'));
  window.eval(fs.readFileSync('src/content/seerr-integration.js', 'utf8'));
  return {
    dom, window, sent,
    observe: () => window.dispatchEvent(new window.MessageEvent('message', {
      data: { channel: 'super-seerr:api', url: 'https://seerr.example/api/v1/discover/movies', items },
      origin: 'https://seerr.example', source: window
    }))
  };
}

const rtLookups = sent => sent.filter(m => m.action === 'getRottenTomatoesRatings').map(m => m.data);

test('the release year reaches the Rotten Tomatoes lookup', async t => {
  const ctx = grid([{ id: 277834, mediaType: 'movie', title: 'Moana', posterPath: '/moana.jpg', releaseDate: '2016-11-14' }]);
  t.after(() => ctx.dom.window.close());
  await settle();
  ctx.observe();
  await settle();

  const moana = rtLookups(ctx.sent).find(d => d.title === 'Moana');
  assert.ok(moana, `no lookup for Moana; saw ${JSON.stringify(rtLookups(ctx.sent))}`);
  assert.equal(moana.year, 2016, 'without this the remake cannot be told apart');
});

test('a series uses its first air date', async t => {
  const ctx = grid([{ id: 1396, mediaType: 'tv', title: 'Breaking Bad', posterPath: '/bb.jpg', firstAirDate: '2008-01-20' }]);
  t.after(() => ctx.dom.window.close());
  await settle();
  ctx.observe();
  await settle();

  const show = rtLookups(ctx.sent).find(d => d.title === 'Breaking Bad');
  assert.ok(show, 'a series should be looked up too');
  assert.equal(show.year, 2008);
});

test('a title and its remake are looked up as different years', async t => {
  const ctx = grid([
    { id: 277834, mediaType: 'movie', title: 'Moana', posterPath: '/a.jpg', releaseDate: '2016-11-14' },
    { id: 1241982, mediaType: 'movie', title: 'Moana', posterPath: '/b.jpg', releaseDate: '2026-07-10' }
  ]);
  t.after(() => ctx.dom.window.close());
  await settle();
  ctx.observe();
  await settle();

  const years = rtLookups(ctx.sent).filter(d => d.title === 'Moana').map(d => d.year).sort();
  assert.deepEqual(years, [2016, 2026], `each should carry its own year, saw ${JSON.stringify(years)}`);
});

test('a film and its remake resolve to their own scores when years are known', async () => {
  const { loadWorker } = require('./helpers/worker');
  const both = [
    { href: '/m/moana', title: 'Moana', year: 2016, rtCriticsScore: 95 },
    { href: '/m/moana_2026', title: 'Moana', year: 2026, rtCriticsScore: 33 }
  ];
  for (const [year, expected] of [[2016, 95], [2026, 33]]) {
    const worker = loadWorker();
    worker.api.fetchRtHtml = async () => '';
    worker.api.parseRtSearchResults = () => both;
    worker.api.parseRtScorecard = () => ({});
    const result = await worker.api.getRottenTomatoesRatings({ title: 'Moana', year, mediaType: 'movie' });
    assert.equal(result.rtCriticsScore, expected, `${year} should get its own score`);
    assert.equal(result.confidence, 1, 'and be certain, so no approximate marker');
  }
});

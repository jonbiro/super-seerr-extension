// Rotten Tomatoes lists most films under their English title. A Seerr showing
// titles in another language, or a site like Filmweb, gives us the localised
// one, which finds nothing. The original title is the way back.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker } = require('./helpers/worker');

// A Rotten Tomatoes that only knows the titles it is given.
function rtKnowing(entries) {
  const worker = loadWorker();
  const searched = [];
  // Record search queries only; the detail-page fetch is not a search.
  worker.api.fetchRtHtml = async url => {
    const query = String(url).split('search=')[1];
    if (query) searched.push(decodeURIComponent(query));
    return '';
  };
  worker.api.parseRtSearchResults = () => {
    const query = searched[searched.length - 1];
    const found = entries[query];
    return found ? [found] : [];
  };
  worker.api.parseRtScorecard = () => ({ rtAudienceScore: 90 });
  return { worker, searched };
}

const PARASITE = { href: '/m/parasite_2019', title: 'Parasite', year: 2019, rtCriticsScore: 99 };

test('the original title is tried when the localised one finds nothing', async () => {
  const { worker, searched } = rtKnowing({ Parasite: PARASITE });

  const result = await worker.api.getRottenTomatoesRatings(
    { title: '기생충', originalTitle: 'Parasite', year: 2019, mediaType: 'movie' });

  assert.ok(result, 'the film should be found under its original title');
  assert.equal(result.rtCriticsScore, 99);
  assert.deepEqual([...searched], ['기생충', 'Parasite'], 'localised first, then original');
});

test('the original title is not searched when the localised one works', async () => {
  const { worker, searched } = rtKnowing({ Parasite: PARASITE, 기생충: PARASITE });

  await worker.api.getRottenTomatoesRatings(
    { title: '기생충', originalTitle: 'Parasite', year: 2019, mediaType: 'movie' });

  assert.deepEqual([...searched], ['기생충'], 'no second request once a match is found');
});

test('a title identical to its original is searched once', async () => {
  // Only observable when the query fails: a match breaks the loop anyway, so
  // a successful search would hide a missing dedup.
  const { worker, searched } = rtKnowing({});

  await worker.api.getRottenTomatoesRatings(
    { title: 'Unheard Of', originalTitle: 'Unheard Of', year: 2019, mediaType: 'movie' });

  assert.deepEqual([...searched], ['Unheard Of'], 'the same query must not be repeated');
});

test('titles differing only in accent count as the same query', async () => {
  const { worker, searched } = rtKnowing({});

  await worker.api.getRottenTomatoesRatings(
    { title: 'Amélie', originalTitle: 'Amelie', year: 2001, mediaType: 'movie' });

  assert.equal(searched.length, 1, 'normalisation makes these one query');
});

test('both failing yields nothing, and is remembered', async () => {
  const { worker, searched } = rtKnowing({});

  const result = await worker.api.getRottenTomatoesRatings(
    { title: '기생충', originalTitle: 'Parasite', year: 2019, mediaType: 'movie' });

  assert.equal(result, null);
  assert.equal(searched.length, 2, 'both were tried');
  await worker.api.getRottenTomatoesRatings(
    { title: '기생충', originalTitle: 'Parasite', year: 2019, mediaType: 'movie' });
  assert.equal(searched.length, 2, 'and the failure is cached, not retried');
});

test('a title ambiguous in one language can resolve in the other', async () => {
  const worker = loadWorker();
  const searched = [];
  // Record search queries only; the detail-page fetch is not a search.
  worker.api.fetchRtHtml = async url => {
    const query = String(url).split('search=')[1];
    if (query) searched.push(decodeURIComponent(query));
    return '';
  };
  worker.api.parseRtSearchResults = () => {
    const query = searched[searched.length - 1];
    // Two films share the localised title; the original is unique.
    if (query === 'Moana') return [
      { href: '/m/a', title: 'Moana', year: 2016, rtCriticsScore: 95 },
      { href: '/m/b', title: 'Moana', year: 2026, rtCriticsScore: 33 }];
    return [{ href: '/m/vaiana', title: 'Vaiana', year: 2016, rtCriticsScore: 95 }];
  };
  worker.api.parseRtScorecard = () => ({});

  const result = await worker.api.getRottenTomatoesRatings(
    { title: 'Moana', originalTitle: 'Vaiana', mediaType: 'movie' });

  assert.ok(result, 'the unambiguous original should rescue it');
  assert.equal(result.rtCriticsScore, 95);
});

test('no original title is a single search, as before', async () => {
  const { worker, searched } = rtKnowing({ Parasite: PARASITE });
  await worker.api.getRottenTomatoesRatings({ title: 'Parasite', year: 2019, mediaType: 'movie' });
  assert.equal(searched.length, 1);
});

test('the original title reaches the worker from the page', async t => {
  // Seerr's list data carries originalTitle; without threading it through,
  // the worker has only the localised name to search by.
  const fs = require('node:fs'); const { JSDOM } = require('jsdom');
  const settle = async () => {
    for (let i = 0; i < 16; i++) await new Promise(r => setImmediate(r));
    await new Promise(r => setTimeout(r, 300));
    for (let i = 0; i < 16; i++) await new Promise(r => setImmediate(r));
  };
  const dom = new JSDOM('<main><div id="grid"><article data-testid="title-card"><div role="link"><img alt="" src="https://image.tmdb.org/t/p/w300/p.jpg"></div></article></div></main>',
    { url: 'https://seerr.example/discover/movies', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const { window } = dom;
  const sent = [];
  window.chrome = {
    storage: { sync: { get: async () => ({ seerrUrl: 'https://seerr.example' }) },
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} }, onChanged: { addListener() {} } },
    runtime: { sendMessage: async m => { sent.push(m);
      return m.action === 'getConfigState' ? { success: true, data: { apiConfigured: false } }
        : { success: true, data: { rtCriticsScore: 99, confidence: 1 } }; } }
  };
  window.fetch = async () => ({ ok: true, json: async () => ({ results: [] }) });
  for (const f of ['RatingsModel', 'RatingsConfig']) window.eval(fs.readFileSync(`src/shared/${f}.js`, 'utf8'));
  window.eval(fs.readFileSync('src/content/seerr-integration.js', 'utf8'));
  await settle();

  window.dispatchEvent(new window.MessageEvent('message', {
    data: { channel: 'super-seerr:api', url: 'https://seerr.example/api/v1/discover/movies',
      items: [{ id: 496243, mediaType: 'movie', title: '기생충', originalTitle: 'Parasite', posterPath: '/p.jpg', releaseDate: '2019-05-30' }] },
    origin: 'https://seerr.example', source: window
  }));
  await settle();

  const lookup = sent.filter(m => m.action === 'getRottenTomatoesRatings').map(m => m.data)[0];
  assert.ok(lookup, `no lookup was made; saw ${JSON.stringify(sent.map(m => m.action))}`);
  assert.equal(lookup.title, '기생충');
  assert.equal(lookup.originalTitle, 'Parasite', 'the original must reach the worker');
  assert.equal(lookup.year, 2019);
});

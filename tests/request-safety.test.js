const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker } = require('./helpers/worker');
const Validation = require('../src/shared/MediaValidation');
const CONFIGURED = { get: async () => ({ seerrUrl: 'https://seerr.example' }), local: { seerrApiKey: 'key' } };
const film = (id, title, year = 1999, mediaType = 'movie') => ({ id, title, releaseDate: `${year}-01-01`, mediaType });
const wanted = { title: 'Fight Club', year: 1999, mediaType: 'movie' };

test('write matching requires a unique title, matching media type, and corroborating year', () => {
  const { api } = loadWorker();
  for (const results of [
    [film(1, 'Unrelated')],
    [film(1, 'Fight Club 2')],
    [film(1, 'Fight Club', 2020)],
    [film(1, 'Fight Club', 1999, 'tv')],
    [film(1, 'Fight Club'), film(2, 'Fight Club', 2000)]
  ]) assert.equal(api.findBestMatch(results, wanted), null);
  assert.equal(api.findBestMatch([film(1, 'Unrelated'), film(2, 'Fight Club')], wanted).id, 2);
  assert.equal(api.findBestMatch([film(1, 'Fight Club'), film(2, 'Fight Club', 2020)], { ...wanted, year: null }), null);
});

test('normalisation does not match unrelated number words or erase non-Latin titles', () => {
  const { api } = loadWorker();
  assert.equal(api.areTitlesSimilar('Seven Samurai', 'Toy Story 7'), false);
  assert.equal(api.areTitlesSimilar('千と千尋の神隠し', '天空の城ラピュタ'), false);
  assert.equal(api.areTitlesSimilar('Amélie', 'Amelie'), true);
  assert.equal(api.areTitlesSimilar('Se7en', 'Seven'), true);
});

test('search variants cannot weaken the identity used to approve a request', async () => {
  const { api, ready } = loadWorker(CONFIGURED);
  await ready;
  let posts = 0;
  api.searchMedia = async () => [film(1, 'Alien')];
  api.makeAPIRequest = async () => { posts++; return {}; };
  await assert.rejects(api.requestMedia({ title: 'Alien: Resurrection', mediaType: 'movie' }), /No unambiguous match/);
  assert.equal(posts, 0);
  const status = await api.getMediaStatus({ title: 'Alien: Resurrection', mediaType: 'movie' });
  assert.equal(status.status, 'unmatched');
  assert.equal(status.action, 'choose');
});

test('a narrower query cannot erase ambiguity discovered by an earlier query', async () => {
  const { api, ready } = loadWorker(CONFIGURED);
  await ready;
  const queries = [];
  api.searchMedia = async query => {
    queries.push(query);
    return query === 'The Thing'
      ? [film(1, 'The Thing', 1982), film(2, 'The Thing', 2011)]
      : [film(1, 'The Thing', 1982)];
  };
  api.makeAPIRequest = async () => assert.fail('must not post an ambiguous title');
  await assert.rejects(api.requestMedia({ title: 'The Thing', mediaType: 'movie' }), /No unambiguous match/);
  assert.deepEqual(queries, ['The Thing']);
});

test('a unique corroborated match posts the correct ID exactly once', async () => {
  const { api, ready } = loadWorker(CONFIGURED);
  await ready;
  api.searchMedia = async () => [film(999, 'Not Fight Club'), film(550, 'Fight Club')];
  const posts = [];
  api.makeAPIRequest = async (method, endpoint, body) => { posts.push({ method, endpoint, body }); return { id: 42 }; };
  assert.equal((await api.requestMedia(wanted)).id, 42);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.mediaId, 550);
});

test('invalid IDs and media types fail before any API traffic', async () => {
  const { api, ready } = loadWorker(CONFIGURED);
  await ready;
  const calls = [];
  api.makeAPIRequest = async (...args) => { calls.push(args); return {}; };
  const badIds = [0, -1, 1.5, '123abc', '', ' ', {}, [], true, Infinity, Number.MAX_SAFE_INTEGER + 1];
  for (const tmdbId of badIds) {
    for (const method of ['requestMedia', 'getMediaStatus', 'addToWatchlist']) {
      await assert.rejects(api[method]({ ...wanted, tmdbId }), /positive integer TMDB id/);
    }
  }
  for (const tmdbId of [null, undefined]) {
    await assert.rejects(api.addToWatchlist({ ...wanted, tmdbId }), /positive integer TMDB id/);
  }
  for (const mediaType of [undefined, null, 'person', '../settings', 1]) {
    for (const method of ['requestMedia', 'getMediaStatus', 'addToWatchlist']) {
      await assert.rejects(api[method]({ tmdbId: 550, mediaType }), /Media type/);
    }
  }
  assert.equal(calls.length, 0);
  assert.equal(Validation.tmdbId('550'), 550);
});

test('failed request-list, detail, and search lookups are errors, not requestable media', async () => {
  for (const failure of ['requests', 'details', 'search']) {
    const { api, ready } = loadWorker(CONFIGURED);
    await ready;
    api.makeAPIRequest = async (_, endpoint) => {
      if (endpoint.includes('/search')) throw new Error('HTTP 401');
      if (endpoint.includes('/request')) {
        if (failure === 'requests') throw new Error('offline');
        return { results: [] };
      }
      throw new Error('HTTP 500');
    };
    const status = await api.getMediaStatus({ ...wanted, ...(failure !== 'search' ? { tmdbId: 550 } : {}) });
    assert.equal(status.status, 'error', failure);
    assert.equal(status.action, 'retryStatus');
    assert.equal(status.buttonText, 'Retry status');
  }
});

test('a successful detail with no media record remains requestable', async () => {
  const { api, ready } = loadWorker(CONFIGURED);
  await ready;
  api.makeAPIRequest = async (_, endpoint) => endpoint.includes('/request') ? { results: [] } : { id: 550, mediaInfo: null };
  assert.equal((await api.getMediaStatus({ ...wanted, tmdbId: 550 })).status, 'available');
});

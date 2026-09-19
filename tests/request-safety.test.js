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

test('a page id naming another title is distrusted, not written', async () => {
  const { api, ready } = loadWorker(CONFIGURED);
  await ready;
  // The page claims TMDB 999 for "Dune" (2021); Seerr says 999 is a 2024 film.
  api.makeAPIRequest = async (method, endpoint, data) => {
    if (method === 'POST') return { posted: data };
    if (endpoint === '/api/v1/movie/999') return { id: 999, title: 'Dune Messiah', releaseDate: '2024-03-01' };
    throw new Error(`unrouted ${method} ${endpoint}`);
  };
  assert.equal(await api.tmdbIdentityMatches({ title: 'Dune', year: 2021, mediaType: 'movie', tmdbId: 999 }), false);
});

test('a translated title keeping its year stays trusted', async () => {
  const { api, ready } = loadWorker(CONFIGURED);
  await ready;
  api.makeAPIRequest = async () => ({ id: 438631, title: 'Dune', originalTitle: 'Diuna', releaseDate: '2021-09-03' });
  assert.equal(await api.tmdbIdentityMatches({ title: 'Diuna', year: 2021, mediaType: 'movie', tmdbId: 438631 }), true);
});

test('an id Seerr cannot look up stays trusted for Seerr to judge', async () => {
  const { api, ready } = loadWorker(CONFIGURED);
  await ready;
  api.makeAPIRequest = async () => { throw new Error('HTTP 404'); };
  assert.equal(await api.tmdbIdentityMatches({ title: 'Dune', year: 2021, mediaType: 'movie', tmdbId: 999 }), true);
});

test('a contradicted page id falls back to search instead of posting', async () => {
  const { api, ready } = loadWorker(CONFIGURED);
  await ready;
  const posts = [];
  api.makeAPIRequest = async (method, endpoint, data) => {
    if (method === 'POST') { posts.push(data); return { id: 1, type: 'movie', status: 1 }; }
    if (endpoint === '/api/v1/movie/999') return { id: 999, title: 'Dune Messiah', releaseDate: '2024-03-01' };
    throw new Error(`unrouted ${method} ${endpoint}`);
  };
  api.searchMedia = async () => [{ id: 438631, mediaType: 'movie', title: 'Dune', releaseDate: '2021-09-15' }];

  await api.requestMedia({ title: 'Dune', year: 2021, mediaType: 'movie', tmdbId: 999 });
  assert.equal(posts.length, 1, 'exactly one write');
  assert.equal(posts[0].mediaId, 438631, 'the search-resolved id, never the contradicted page id');
});

test('a corroborated page id skips search entirely', async () => {
  const { api, ready } = loadWorker(CONFIGURED);
  await ready;
  const posts = [];
  api.makeAPIRequest = async (method, endpoint, data) => {
    if (method === 'POST') { posts.push(data); return { id: 1, type: 'movie', status: 1 }; }
    if (endpoint === '/api/v1/movie/438631') return { id: 438631, title: 'Dune', releaseDate: '2021-09-03' };
    throw new Error(`unrouted ${method} ${endpoint}`);
  };
  api.searchMedia = async () => { throw new Error('search must not run for a corroborated id'); };

  await api.requestMedia({ title: 'Dune', year: 2021, mediaType: 'movie', tmdbId: 438631 });
  assert.equal(posts[0].mediaId, 438631);
});

test('status for a contradicted page id resolves by search', async () => {
  const { api, ready } = loadWorker(CONFIGURED);
  await ready;
  api.makeAPIRequest = async (_, endpoint) => {
    // The page id names an available title; the searched one is requestable.
    if (endpoint === '/api/v1/movie/999') {
      return { id: 999, title: 'Other Film', releaseDate: '2024-01-01', mediaInfo: { status: 5, mediaUrl: 'https://media.example/x' } };
    }
    if (endpoint === '/api/v1/request?take=100&skip=0') return { results: [] };
    if (endpoint === '/api/v1/movie/438631') return { id: 438631, title: 'Dune', mediaInfo: undefined };
    throw new Error(`unrouted ${endpoint}`);
  };
  api.searchMedia = async () => [{ id: 438631, mediaType: 'movie', title: 'Dune', releaseDate: '2021-09-15' }];

  const status = await api.getMediaStatus({ title: 'Dune', year: 2021, mediaType: 'movie', tmdbId: 999 });
  assert.equal(status.buttonClass, 'request', 'must describe the searched title, not the contradicted id');
});

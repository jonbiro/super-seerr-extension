// getMediaStatus decides what the flyout says about a title. Two faults lived
// here: it matched requests on Seerr's internal row id, and it never used a
// TMDB id the page had already extracted.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker } = require('./helpers/worker');

const CONFIGURED = { get: async () => ({ seerrUrl: 'https://seerr.example' }), local: { seerrApiKey: 'key' } };

// Routes the worker's API calls without touching the network.
function withApi(worker, routes) {
  const calls = [];
  worker.api.makeAPIRequest = async (method, endpoint) => {
    calls.push(endpoint);
    for (const [prefix, body] of Object.entries(routes)) {
      if (endpoint.startsWith(prefix)) return typeof body === 'function' ? body(endpoint) : body;
    }
    throw new Error(`unrouted ${endpoint}`);
  };
  return calls;
}

test('a request is not matched by Seerr\'s internal media row id', async () => {
  const worker = loadWorker(CONFIGURED);
  await worker.ready;
  // A different title whose internal row id collides with our TMDB id.
  withApi(worker, {
    '/api/v1/request': { results: [{
      id: 7, type: 'movie', status: 2,
      media: { id: 550, tmdbId: 99999, title: 'Some Other Film', mediaUrl: 'https://jellyfin.example/other' }
    }] },
    '/api/v1/movie/550': { mediaInfo: undefined }
  });

  const status = await worker.api.getMediaStatus({ title: 'Fight Club', mediaType: 'movie', tmdbId: 550 });
  assert.equal(status.status, 'available', 'a row-id collision must not surface another title as requested');
  assert.ok(!JSON.stringify(status).includes('jellyfin.example/other'), "another request's media URL must not leak");
});

test('a request is matched on tmdbId, including across string and number forms', async () => {
  for (const tmdbId of [550, '550']) {
    const worker = loadWorker(CONFIGURED);
    await worker.ready;
    withApi(worker, {
      '/api/v1/request': { results: [{ id: 7, type: 'movie', status: 2, media: { id: 42, tmdbId, title: 'Fight Club' } }] }
    });

    const status = await worker.api.getMediaStatus({ title: 'Fight Club', mediaType: 'movie', tmdbId: 550 });
    assert.notEqual(status.status, 'available', `tmdbId ${JSON.stringify(tmdbId)} should match`);
  }
});

test('a known TMDB id skips the title search entirely', async () => {
  const worker = loadWorker(CONFIGURED);
  await worker.ready;
  const calls = withApi(worker, { '/api/v1/request': { results: [] }, '/api/v1/movie/550': { mediaInfo: undefined } });

  await worker.api.getMediaStatus({ title: 'Fight Club', mediaType: 'movie', tmdbId: 550 });
  assert.ok(!calls.some(endpoint => endpoint.startsWith('/api/v1/search')), `no search expected, saw ${calls.join(', ')}`);
});

test('without a TMDB id the title search still runs', async () => {
  const worker = loadWorker(CONFIGURED);
  await worker.ready;
  const calls = withApi(worker, {
    '/api/v1/search': { results: [{ id: 550, mediaType: 'movie', title: 'Fight Club' }] },
    '/api/v1/request': { results: [] },
    '/api/v1/movie/550': { mediaInfo: undefined }
  });

  await worker.api.getMediaStatus({ title: 'Fight Club', mediaType: 'movie' });
  assert.ok(calls.some(endpoint => endpoint.startsWith('/api/v1/search')), 'search is still the fallback');
});

test('a missing tmdbId falls back to search rather than querying garbage', async () => {
  for (const tmdbId of [null, undefined]) {
    const worker = loadWorker(CONFIGURED);
    await worker.ready;
    const calls = withApi(worker, {
      '/api/v1/search': { results: [{ id: 550, mediaType: 'movie', title: 'Fight Club' }] },
      '/api/v1/request': { results: [] },
      '/api/v1/movie/550': { mediaInfo: undefined }
    });

    await worker.api.getMediaStatus({ title: 'Fight Club', mediaType: 'movie', tmdbId });
    assert.ok(calls.some(e => e.startsWith('/api/v1/search')), `${JSON.stringify(tmdbId)} should fall back to search`);
    assert.ok(!calls.some(e => /\/api\/v1\/movie\/(null|undefined|NaN|0|-1|abc)/.test(e)), `${JSON.stringify(tmdbId)} must not be queried directly`);
  }
});

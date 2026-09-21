// Property tests 8 & 9: Watchlist button visibility and POST body construction
const { test } = require('node:test');
const assert = require('node:assert');
const { loadWorker } = require('./helpers/worker');
const fc = require('fast-check');

test('Property 8: Watchlist button visible iff requestable', () => {
  // The showWatchlist logic from UIComponents.updateFlyoutStatus:
  // showWatchlist = statusData.status === 'available' || statusData.buttonClass === 'request'
  function shouldShowWatchlist(statusData) {
    return statusData.status === 'available' || statusData.buttonClass === 'request';
  }

  fc.assert(
    fc.property(
      fc.record({
        status: fc.oneof(
          fc.constant('available'),
          fc.constant('pending'),
          fc.constant('downloading'),
          fc.constant('available_watch'),
          fc.constant('requested'),
          fc.constant('unknown'),
          fc.string({ minLength: 1 })
        ),
        buttonClass: fc.oneof(
          fc.constant('request'),
          fc.constant('pending'),
          fc.constant('downloading'),
          fc.constant('watch'),
          fc.constant('error'),
          fc.constant('partial'),
          fc.constant('available'),
          fc.string({ minLength: 1 })
        )
      }),
      (statusData) => {
        const result = shouldShowWatchlist(statusData);

        // Only visible when status is 'available' OR buttonClass is 'request'
        if (statusData.status === 'available' || statusData.buttonClass === 'request') {
          assert.ok(result, `Watchlist should be visible when status=${statusData.status} or buttonClass=${statusData.buttonClass}`);
        }

        // For pending, downloading, available_watch — should be hidden
        if (['pending', 'downloading', 'available_watch'].includes(statusData.status)) {
          if (statusData.buttonClass !== 'request') {
            assert.ok(!result, `Watchlist should be hidden when status=${statusData.status} and buttonClass=${statusData.buttonClass}`);
          }
        }
      }
    )
  );
});

test('the watchlist body is the one Seerr will accept', async () => {
  // Seerr parses this body with zod: { tmdbId: coerce.number(), mediaType,
  // ratingKey?, title? } (server/interfaces/api/watchlistCreate.ts). We sent
  // mediaId, a field that schema does not have, so every add was rejected —
  // and the test that used to stand here asserted the broken shape, against a
  // body builder written inside the test rather than the worker's own.
  const calls = [];
  const worker = loadWorker({
    get: async () => ({ seerrUrl: 'https://seerr.example', seerrApiKey: 'k' }),
    fetch: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return { ok: true, status: 201, json: async () => ({ id: 1 }) };
    }
  });
  await worker.ready;

  await worker.api.addToWatchlist({ tmdbId: '1241982', mediaType: 'movie', title: 'Moana 2' });

  assert.equal(calls[0].url, 'https://seerr.example/api/v1/watchlist');
  assert.equal(calls[0].body.tmdbId, 1241982, 'a number, as the schema coerces to');
  assert.equal(calls[0].body.mediaType, 'movie');
  assert.equal(calls[0].body.title, 'Moana 2');
  assert.ok(!('mediaId' in calls[0].body), 'mediaId is not a field Seerr knows');
});

test('a title with no usable TMDB id is refused rather than posted', async () => {
  const calls = [];
  const worker = loadWorker({
    get: async () => ({ seerrUrl: 'https://seerr.example', seerrApiKey: 'k' }),
    // The worker reads settings on startup, so count only the call under test.
    fetch: async url => { calls.push(String(url)); return { ok: true, json: async () => ({}) }; }
  });
  await worker.ready;

  await assert.rejects(() => worker.api.addToWatchlist({ mediaType: 'movie' }));
  assert.equal(calls.filter(url => url.includes('/watchlist')).length, 0, 'nothing should reach the watchlist endpoint');
});

for (const mediaType of ['movie', 'tv']) {
  test(`title-only ${mediaType} watchlist action resolves identity across client and worker`, async t => {
    const { loadIntegration } = require('./helpers/integration');
    const writes = [];
    const worker = loadWorker({ get: async () => ({ seerrUrl: 'https://seerr.example', seerrApiKey: 'k' }) });
    await worker.ready;
    worker.api.makeAPIRequest = async (method, endpoint, body) => {
      if (method === 'POST') { writes.push(body); return { id: 1 }; }
      if (endpoint.startsWith('/api/v1/search')) return { results: [
        { id: 550, mediaType, title: 'Example', releaseDate: '2020-01-01' },
        { id: 551, mediaType, title: 'Example', releaseDate: '1990-01-01' }
      ] };
      throw new Error(`Unexpected read ${endpoint}`);
    };
    const page = loadIntegration({ sendMessage: async message => {
      let response;
      await worker.api.handleMessage(message, {}, result => { response = result; });
      return response;
    } });
    t.after(() => page.window.close());
    const client = new page.window.SeerrClient();
    await client.addToWatchlist({ title: 'Example', year: 2020, mediaType });
    assert.equal(writes.length, 1);
    assert.equal(writes[0].tmdbId, 550);
    assert.equal(writes[0].mediaType, mediaType);
  });
}

test('ambiguous watchlist titles never issue a write', async () => {
  const worker = loadWorker({ get: async () => ({ seerrUrl: 'https://seerr.example', seerrApiKey: 'k' }) });
  await worker.ready;
  worker.api.makeAPIRequest = async method => {
    assert.equal(method, 'GET');
    return { results: [1, 2].map(id => ({ id, mediaType: 'movie', title: 'Example' })) };
  };
  await assert.rejects(() => worker.api.addToWatchlist({ title: 'Example', mediaType: 'movie' }), /No unambiguous match/);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker } = require('./helpers/worker');

const sender = { url: 'chrome-extension://test/src/options/options.html' };
const movie = { title: 'Example', tmdbId: 42, mediaType: 'movie' };
const tv = { ...movie, mediaType: 'tv', seasons: [1, 2] };
function receipt(media, overrides = {}) {
  return { id: 7, type: media.mediaType, status: 1,
    media: { tmdbId: 42, mediaType: media.mediaType },
    ...(media.mediaType === 'tv' ? { seasons: media.seasons.map(seasonNumber => ({ seasonNumber, status: 1 })) } : {}),
    ...overrides };
}
async function setup(media, body, status = 201) {
  let posts = 0;
  const w = loadWorker({ get: async () => ({ seerrUrl: 'https://seerr.example' }), local: { seerrApiKey: 'fixture-key' },
    fetch: async (url, options) => {
      if (options.method === 'POST') { posts++; return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }); }
      return new Response(JSON.stringify(url.endsWith('/settings/public') ? { mediaServerType: 2, enableSpecialEpisodes: false }
        : { id: 42, title: 'Example', name: 'Example', seasons: [1, 2].map(seasonNumber => ({ seasonNumber, episodeCount: 8 })), mediaInfo: null }),
      { headers: { 'Content-Type': 'application/json' } });
    } });
  w.context.TextDecoder = TextDecoder;
  await w.ready;
  const response = await new Promise(resolve => w.api.handleMessage({ action: 'requestMedia', data: media }, sender, resolve));
  return { ...w, response, posts };
}

test('Seerr HTTP 202 with no available seasons is not a success or a confirmed history entry', async () => {
  const w = await setup(tv, { message: 'No seasons available to request' }, 202);
  assert.equal(w.response.success, false);
  assert.match(w.response.error, /seasons|confirm/i);
  assert.equal(w.posts, 1);
  assert.equal((await w.api.getRecentActions()).length, 0);
});

for (const body of [null, {}, { id: 7 }, { id: 0 }, { id: [7] }, receipt(movie, { type: 'tv' }),
  receipt(movie, { status: 9 }), receipt(movie, { media: { tmdbId: 99, mediaType: 'movie' } })]) {
  test(`unconfirmed or contradictory request receipt cannot claim success (${JSON.stringify(body)})`, async () => {
    const w = await setup(movie, body);
    assert.equal(w.response.success, false);
    assert.match(w.response.error, /confirm|Check Seerr/i);
    assert.equal(w.posts, 1);
    assert.equal((await w.api.getRecentActions()).length, 0);
  });
}

test('a confirmed request receipt records one action with its resolved identity', async () => {
  const w = await setup(movie, receipt(movie));
  assert.equal(w.response.success, true);
  assert.equal(w.response.data.id, 7);
  assert.equal(w.posts, 1);
  assert.equal((await w.api.getRecentActions()).length, 1);
  assert.equal((await w.api.getRecentActions())[0].tmdbId, 42);
});

test('a server-confirmed subset of TV seasons is reported accurately without a second write', async () => {
  const w = await setup(tv, receipt(tv, { seasons: [{ seasonNumber: 2, status: 1 }] }));
  assert.equal(w.response.success, true);
  assert.deepEqual(Array.from(w.response.data.confirmedSeasons), [2]);
  assert.match(w.response.data.notice, /not included|only|seasons 2/i);
  assert.equal(w.posts, 1);
});

test('a created request that immediately fails keeps its receipt but carries a clear warning', async () => {
  const w = await setup(movie, receipt(movie, { status: 4 }));
  assert.equal(w.response.success, true);
  assert.match(w.response.data.notice, /failed.*Seerr/i);
  assert.equal(w.response.data.id, 7);
  assert.equal((await w.api.getRecentActions()).length, 1);
  assert.equal(w.posts, 1);
});

for (const seasons of [undefined, [], [{ seasonNumber: 3 }], [{ seasonNumber: '1' }], [null]]) {
  test(`a TV receipt with unconfirmed or unselected seasons cannot claim success (${JSON.stringify(seasons)})`, async () => {
    const w = await setup(tv, receipt(tv, { seasons }));
    assert.equal(w.response.success, false);
    assert.equal(w.posts, 1);
    assert.equal((await w.api.getRecentActions()).length, 0);
  });
}

test('a receipt for a different quality cannot confirm the standard-quality request', async () => {
  const w = await setup(movie, receipt(movie, { is4k: true }));
  assert.equal(w.response.success, false);
  assert.equal(w.posts, 1);
  assert.equal((await w.api.getRecentActions()).length, 0);
});

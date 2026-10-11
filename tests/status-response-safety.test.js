const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker } = require('./helpers/worker');

for (const requests of [
  [null, { status: 4, is4k: false }],
  [{ status: 1, is4k: true }, { status: 4, is4k: false }],
  [{ type: 'tv', status: 1 }, { type: 'movie', status: 4 }],
  [{}, { status: 4 }]
]) {
  test(`embedded requests skip irrelevant entries: ${JSON.stringify(requests)}`, () => {
    const { api } = loadWorker();
    const result = api.formatMediaStatus({ id: 550, requests, mediaInfo: { status: 1 } }, 'movie');
    assert.equal(result.status, 'failed');
    assert.equal(result.buttonText, 'Try Again');
  });
}

test('a 4K-only embedded request leaves standard media availability intact', () => {
  const { api } = loadWorker();
  const result = api.formatMediaStatus({ id: 550, requests: [{ status: 1, is4k: true }],
    mediaInfo: { status: 5, mediaUrl: 'https://media.example/watch/550' } }, 'movie');
  assert.equal(result.status, 'available_watch');
  assert.equal(result.watchUrl, 'https://media.example/watch/550');
});

for (const status of [null, '5junk', '3.8', 3.8, [], [5], true, '', ' ', 0, -1, 8]) {
  test(`malformed media status ${JSON.stringify(status)} offers a status retry`, () => {
    const { api } = loadWorker();
    const result = api.formatMediaStatus({ id: 550, mediaInfo: { status } }, 'movie');
    assert.equal(result.status, 'error');
    assert.equal(result.action, 'retryStatus');
    assert.equal(result.buttonText, 'Retry Status');
  });
}

test('a media-only enum value cannot become a requestable request status', () => {
  const { api } = loadWorker();
  const result = api.formatMediaStatus({ status: 6, media: { tmdbId: 550 } }, 'movie');
  assert.equal(result.action, 'retryStatus');
});

test('valid numeric string status remains supported', () => {
  const { api } = loadWorker();
  assert.equal(api.formatMediaStatus({ mediaInfo: { status: '5' } }, 'movie').status, 'available_watch');
});

test('null season entries cannot prevent TV status rendering', () => {
  const { api } = loadWorker();
  const result = api.formatMediaStatus({ mediaInfo: { status: 3, seasons: [null, { status: 5 }, { status: 3 }] } }, 'tv');
  assert.equal(result.status, 'downloading');
  assert.match(result.monitoring.message, /1 season/);
});

test('Retry Status refetches a malformed response immediately instead of reusing the raw API cache', async () => {
  const worker = loadWorker({ get: async () => ({ seerrUrl: 'https://home.example', seerrApiKey: 'key' }) });
  await worker.ready;
  let details = 0;
  worker.api.sendAPIRequest = async (method, endpoint) => {
    if (endpoint.startsWith('/api/v1/request?')) return { results: [] };
    details++;
    return { id: 550, mediaInfo: { status: details === 1 ? '5junk' : 5 } };
  };
  const media = { tmdbId: 550, mediaType: 'movie' };
  assert.equal((await worker.api.getMediaStatus(media)).action, 'retryStatus');
  assert.equal((await worker.api.getMediaStatus(media)).status, 'available_watch');
  assert.equal(details, 2);
});

test('a late status error from the previous site cannot evict the current site cache', async () => {
  let server = 'https://home.example';
  const worker = loadWorker({ get: async () => ({ seerrUrl: server, seerrApiKey: 'key' }) });
  await worker.ready;
  let finish, calls = 0;
  worker.api.getMediaStatusUncached = () => {
    calls++;
    return calls === 1 ? new Promise(resolve => { finish = resolve; }) : { status: 'available_watch' };
  };
  const media = { tmdbId: 550, mediaType: 'movie' };
  const previous = worker.api.getMediaStatus(media);
  await Promise.resolve();
  server = 'https://family.example';
  await worker.api.loadSettings();
  assert.equal((await worker.api.getMediaStatus(media)).status, 'available_watch');
  finish({ status: 'error', action: 'retryStatus' });
  await previous;
  assert.equal((await worker.api.getMediaStatus(media)).status, 'available_watch');
  assert.equal(calls, 2, 'new site retains its own completed status read');
});

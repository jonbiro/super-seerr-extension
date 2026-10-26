// requestMedia is a non-idempotent POST. It retried on any error, so a request
// Seerr had already answered was resent up to three times.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const SeerrClient = require('../src/shared/SeerrClient');
const { result: requestResult } = require('./helpers/request-receipt');

function client(replies, { retryDelay = 0 } = {}) {
  const sent = [];
  const instance = new SeerrClient({ siteName: 'Test', retryAttempts: 3, retryDelay });
  instance.testExtensionConnection = async () => true;
  instance.testServerConnection = async () => true;
  instance.sendMessage = async message => {
    sent.push(message.action);
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { instance, sent };
}

const requests = sent => sent.filter(action => action === 'requestMedia').length;

test('a rejection from Seerr is not resent', async () => {
  const { instance, sent } = client([{ success: false, error: 'Request already exists' }]);
  await assert.rejects(instance.requestMedia({ tmdbId: 550 }), /Request already exists/);
  assert.equal(requests(sent), 1, 'a duplicate POST must not be sent after a definite answer');
});

test('every definite rejection is surfaced as-is, once', async () => {
  for (const error of ['Request already exists', 'You do not have permission', 'Invalid TMDB ID: NaN']) {
    const { instance, sent } = client([{ success: false, error }]);
    await assert.rejects(instance.requestMedia({ tmdbId: 550 }), new RegExp(error.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(requests(sent), 1, `"${error}" should not be retried`);
  }
});

test('a lost response never resends a potentially successful POST', async () => {
  // The server may have committed the write before the message port closed.
  const { instance, sent } = client([
    new Error('Could not establish connection'),
    new Error('Could not establish connection'),
    { success: true, data: { id: 1 } }
  ]);
  await assert.rejects(instance.requestMedia({ tmdbId: 550 }), /outcome unknown.*Check Seerr/);
  assert.equal(requests(sent), 1, 'an unknown outcome must not cause another POST');
});

test('write safety is independent of the configured read retry count', async () => {
  const { instance, sent } = client([
    new Error('offline'), new Error('offline'), new Error('offline'), new Error('offline')
  ]);
  await assert.rejects(instance.requestMedia({ tmdbId: 550 }), /offline/);
  assert.equal(requests(sent), 1);
});

test('a successful request is sent exactly once', async () => {
  const { instance, sent } = client([{ success: true, data: requestResult({ tmdbId: 550 }) }]);
  assert.equal((await instance.requestMedia({ tmdbId: 550 })).id, 7);
  assert.equal(requests(sent), 1);
});

for (const data of [undefined, {}, { id: 7 }, requestResult({ mediaType: 'tv', tmdbId: 550, seasons: [3] }),
  requestResult({ mediaType: 'tv', tmdbId: 550, seasons: [1] }, { confirmedSeasons: [] })]) {
  test(`an unconfirmed worker reply is surfaced once (${JSON.stringify(data)})`, async () => {
    const { instance, sent } = client([{ success: true, data }]);
    await assert.rejects(instance.requestMedia({ tmdbId: 550, mediaType: 'tv', seasons: [1, 2] }), /confirmation unavailable.*Check Seerr/);
    assert.equal(requests(sent), 1);
  });
}

test('a partial or failed worker receipt retains its warning through the client', async () => {
  const media = { tmdbId: 550, mediaType: 'tv', seasons: [1, 2] };
  const { instance, sent } = client([{ success: true, data: requestResult({ ...media, seasons: [2] }, { status: 4 }) }]);
  const result = await instance.requestMedia(media);
  assert.match(result.notice, /only these seasons: 2.*not included.*failed in Seerr/);
  assert.deepEqual(result.confirmedSeasons, [2]);
  assert.equal(requests(sent), 1);
});

test('status lookups also stop on a definite answer', async () => {
  const { instance, sent } = client([{ success: false, error: 'Seerr server URL and API key are required' }]);
  await assert.rejects(instance.getMediaStatus({ tmdbId: 550 }), /API key are required/);
  assert.equal(sent.filter(a => a === 'getMediaStatus').length, 1, 'retrying a definite error only delays the message');
});

test('status lookups still retry a failed round trip', async () => {
  const { instance, sent } = client([new Error('port closed'), { success: true, data: { status: 'available' } }]);
  assert.equal((await instance.getMediaStatus({ tmdbId: 550 })).status, 'available');
  assert.equal(sent.filter(a => a === 'getMediaStatus').length, 2);
});

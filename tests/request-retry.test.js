// requestMedia is a non-idempotent POST. It retried on any error, so a request
// Seerr had already answered was resent up to three times.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const SeerrClient = require('../src/shared/SeerrClient');

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

test('a failed round trip is still retried', async () => {
  // The worker never answered, so nothing reached Seerr: resending is safe.
  const { instance, sent } = client([
    new Error('Could not establish connection'),
    new Error('Could not establish connection'),
    { success: true, data: { id: 1 } }
  ]);
  const result = await instance.requestMedia({ tmdbId: 550 });
  assert.equal(result.id, 1);
  assert.equal(requests(sent), 3, 'transport failures are worth retrying');
});

test('retries give up after the configured attempts', async () => {
  const { instance, sent } = client([
    new Error('offline'), new Error('offline'), new Error('offline'), new Error('offline')
  ]);
  await assert.rejects(instance.requestMedia({ tmdbId: 550 }), /offline/);
  assert.equal(requests(sent), 3);
});

test('a successful request is sent exactly once', async () => {
  const { instance, sent } = client([{ success: true, data: { id: 7 } }]);
  assert.equal((await instance.requestMedia({ tmdbId: 550 })).id, 7);
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

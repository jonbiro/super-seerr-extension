// `options.x || default` silently discards a caller's 0. It made retryDelay: 0
// sleep a second per retry, and would turn retryAttempts: 0 into three.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const SeerrClient = require('../src/shared/SeerrClient');

test('a zero retry delay is honoured rather than replaced by the default', () => {
  assert.equal(new SeerrClient({ retryDelay: 0 }).retryDelay, 0);
  assert.equal(new SeerrClient({}).retryDelay, 1000, 'the default still applies when unset');
  assert.equal(new SeerrClient({ retryDelay: 250 }).retryDelay, 250);
});

test('a zero delay actually means no waiting', async () => {
  const client = new SeerrClient({ retryAttempts: 3, retryDelay: 0 });
  client.testExtensionConnection = async () => true;
  let calls = 0;
  client.sendMessage = async () => { calls++; throw new Error('offline'); };

  const started = Date.now();
  await assert.rejects(client.getMediaStatus({ tmdbId: 550 }), /offline/);
  assert.equal(calls, 3);
  assert.ok(Date.now() - started < 500, `retries should not sleep, took ${Date.now() - started}ms`);
});

test('retry attempts never fall below one, so a request is always sent', async () => {
  // A zero here previously became three; honouring it literally would make
  // requestMedia return undefined without ever calling the worker.
  for (const retryAttempts of [0, -1, undefined]) {
    const client = new SeerrClient({ retryAttempts, retryDelay: 0 });
    client.testExtensionConnection = async () => true;
    let calls = 0;
    client.sendMessage = async () => { calls++; return { success: true, data: { id: 1 } }; };

    const result = await client.requestMedia({ tmdbId: 550 });
    assert.equal(calls, 1, `retryAttempts ${retryAttempts} must still send the request`);
    assert.equal(result.id, 1, 'and must return the result, never undefined');
  }
});

test('an explicit attempt count is respected', () => {
  assert.equal(new SeerrClient({ retryAttempts: 1 }).retryAttempts, 1);
  assert.equal(new SeerrClient({ retryAttempts: 5 }).retryAttempts, 5);
  assert.equal(new SeerrClient({}).retryAttempts, 3);
});

test('a request retains the reviewed connection token while its preflight is pending', async () => {
  const client = new SeerrClient();
  client.connectionToken = '1:home';
  let finish;
  client.testExtensionConnection = () => new Promise(resolve => { finish = resolve; });
  let sent;
  client.sendMessage = async message => { sent = message; return { success: true, data: { id: 1 } }; };
  const pending = client.requestMedia({ tmdbId: 550, mediaType: 'movie' });
  client.connectionToken = '2:family';
  finish(true); await pending;
  assert.equal(sent.connectionToken, '1:home');
});

for (const action of ['plexAddToWatchlist', 'plexWatchlistState']) {
  test(`${action} carries the reviewed connection token`, async () => {
    const client = new SeerrClient();
    client.connectionToken = '1:home';
    let sent;
    client.sendMessage = async message => { sent = message; return { success: true, data: {} }; };
    if (action === 'plexAddToWatchlist') await client.plexAddToWatchlist({ tmdbId: 550, mediaType: 'movie', title: 'Fight Club' });
    else await client.plexWatchlistState({ tmdbId: 550, mediaType: 'movie', title: 'Fight Club' });
    assert.equal(sent.connectionToken, '1:home');
  });
}

for (const token of ['1:home', null]) {
  test(`a status read retains its initial connection token (${token}) while preflight is pending`, async () => {
    const client = new SeerrClient();
    client.connectionToken = token;
    let finish, sent;
    client.testExtensionConnection = () => new Promise(resolve => { finish = resolve; });
    client.sendMessage = async message => { sent = message; return { success: true, data: { status: 'available' } }; };
    const pending = client.getMediaStatus({ tmdbId: 550, mediaType: 'movie' });
    client.connectionToken = '2:family';
    finish(true); await pending;
    assert.equal(sent.connectionToken, token);
  });
}

test('status transport retries cannot move an earlier identity to the newly selected site', async () => {
  const client = new SeerrClient({ retryDelay: 0 });
  client.connectionToken = '1:home';
  client.testExtensionConnection = async () => true;
  const messages = [];
  client.sendMessage = async message => {
    messages.push(message);
    if (messages.length === 1) {
      client.connectionToken = '2:family';
      throw new Error('Port closed');
    }
    return { success: false, error: 'Active Seerr site changed' };
  };
  await assert.rejects(client.getMediaStatus({ tmdbId: 550, mediaType: 'movie' }), /site changed/);
  assert.equal(messages.length, 2);
  assert.ok(messages.every(message => message.connectionToken === '1:home'));
});

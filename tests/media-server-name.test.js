// Seerr supports Plex, Jellyfin and Emby, but the flyout said "Jellyfin"
// regardless. Seerr reports which is configured via mediaServerType on the
// unauthenticated /api/v1/settings/public.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loadWorker } = require('./helpers/worker');

const CONFIGURED = { get: async () => ({ seerrUrl: 'https://seerr.example' }), local: { seerrApiKey: 'key' } };
const asMedia = status => ({ id: 550, mediaInfo: { status, mediaUrl: 'https://media.example/watch/1' } });

function workerWith(mediaServerType, { ok = true } = {}) {
  const requested = [];
  const worker = loadWorker({
    ...CONFIGURED,
    fetch: async (url, options) => {
      requested.push({ url: String(url), options });
      if (!ok) throw new Error('offline');
      return { ok: true, json: async () => ({ mediaServerType }) };
    }
  });
  return { worker, requested };
}

test('each media server Seerr supports is named correctly', async () => {
  for (const [type, expected] of [[1, 'Plex'], [2, 'Jellyfin'], [3, 'Emby']]) {
    const { worker } = workerWith(type);
    await worker.ready;
    const result = worker.api.formatMediaStatus(asMedia(5), 'movie');
    assert.match(result.buttonText, new RegExp(expected), `type ${type} should say ${expected}`);
    assert.match(result.message, new RegExp(expected));
  }
});

test('an unconfigured or unknown server gets neutral wording, never a guess', async () => {
  for (const type of [4, 0, undefined, null, 'nonsense']) {
    const { worker } = workerWith(type);
    await worker.ready;
    const result = worker.api.formatMediaStatus(asMedia(5), 'movie');
    for (const product of ['Plex', 'Jellyfin', 'Emby']) {
      assert.ok(!result.buttonText.includes(product), `${JSON.stringify(type)} must not claim ${product}`);
      assert.ok(!result.message.includes(product), `${JSON.stringify(type)} must not claim ${product}`);
    }
    assert.match(result.buttonText, /Watch|Available/);
  }
});

test('the server type is read without needing an API key', async () => {
  const { worker, requested } = workerWith(2);
  await worker.ready;
  const call = requested.find(entry => entry.url.includes('/settings/public'));
  assert.ok(call, 'the public settings endpoint should be consulted');
  assert.ok(call.url.startsWith('https://seerr.example/'), 'on the configured server');
  assert.ok(call.options.signal, 'with a deadline');
  assert.equal(call.options.redirect, 'error', 'and without following redirects');
});

test('a server that will not answer still produces usable wording', async () => {
  const { worker } = workerWith(2, { ok: false });
  await worker.ready;
  const result = worker.api.formatMediaStatus(asMedia(5), 'movie');
  assert.match(result.buttonText, /Watch|Available/);
  assert.ok(!/undefined|null/.test(result.buttonText + result.message));
});

test('product names appear only in the lookup table, never in a message', () => {
  const worker = fs.readFileSync('src/background/background.js', 'utf8');
  const lines = worker.split('\n');
  for (const product of ['Jellyfin', 'Plex', 'Emby']) {
    const mentions = lines.filter(line => line.includes(product));
    assert.ok(mentions.length > 0, `${product} should still be known`);
    for (const line of mentions) {
      assert.ok(line.includes('MEDIA_SERVER_NAMES'), `${product} is baked into: ${line.trim()}`);
    }
  }
});

test('the watch button is recognised by its class, not its label', () => {
  // The label now varies by media server, so matching on text would break it.
  const integration = fs.readFileSync('src/shared/BaseIntegration.js', 'utf8');
  assert.ok(!integration.includes("=== 'Watch on Jellyfin'"), 'no exact-label comparison');
  assert.ok(/classList\.contains\('watch'\)/.test(integration), 'the class is what identifies it');
});

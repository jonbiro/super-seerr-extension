const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker } = require('./helpers/worker');

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('slow cosmetic metadata does not block ping or configured requests', async () => {
  const metadata = deferred();
  const calls = [];
  const worker = loadWorker({
    get: async () => ({ seerrUrl: 'https://seerr.example' }),
    local: { seerrApiKey: 'key' },
    fetch: async url => {
      calls.push(url);
      if (url.endsWith('/settings/public')) return metadata.promise;
      return { ok: true, json: async () => ({ id: 1 }) };
    }
  });
  const ready = await Promise.race([worker.ready.then(() => true), new Promise(r => setTimeout(() => r(false), 100))]);
  assert.equal(ready, true, 'configuration readiness must not depend on the network');
  const ping = await new Promise(resolve => worker.listeners.message({ action: 'ping' }, {}, resolve));
  assert.equal(ping.data, 'pong');
  assert.equal((await worker.api.requestMedia({ tmdbId: 550, mediaType: 'movie' })).id, 1);
  assert.equal(calls.filter(url => url.endsWith('/settings/public')).length, 1);
  assert.equal(worker.api.mediaServerName, null);
  metadata.resolve({ ok: true, json: async () => ({ mediaServerType: 2 }) });
  await worker.api.mediaServerReady;
  assert.equal(worker.api.mediaServerName, 'Jellyfin');
});

test('a late public-settings response cannot rename a different configured server', async () => {
  const first = deferred();
  const worker = loadWorker({ fetch: async url => url.startsWith('https://first.')
    ? first.promise : { ok: true, json: async () => ({ mediaServerType: 3 }) } });
  await worker.ready;
  worker.api.baseUrl = 'https://first.example';
  const slow = worker.api.loadMediaServerName();
  worker.api.baseUrl = 'https://second.example';
  await worker.api.loadMediaServerName();
  first.resolve({ ok: true, json: async () => ({ mediaServerType: 1 }) });
  await slow;
  assert.equal(worker.api.mediaServerName, 'Emby');
});

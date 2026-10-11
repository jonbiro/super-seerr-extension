const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker } = require('./helpers/worker');
const configured = { seerrUrl: 'https://seerr.example', seerrApiKey: 'k' };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

async function fixture() {
  const worker = loadWorker({ get: async () => configured });
  await worker.ready;
  return worker;
}

test('concurrent status callers share one lookup, and error statuses retry', async () => {
  const { api } = await fixture();
  const pending = deferred(); let calls = 0;
  api.getMediaStatusUncached = async () => { calls++; return pending.promise; };
  const media = { tmdbId: 1, mediaType: 'movie' };
  const reads = Array.from({ length: 10 }, () => api.getMediaStatus(media));
  await Promise.resolve();
  assert.equal(calls, 1);
  pending.resolve({ status: 'error' }); await Promise.all(reads);
  api.getMediaStatusUncached = async () => { calls++; return { status: 'available' }; };
  await api.getMediaStatus(media); await api.getMediaStatus(media);
  assert.equal(calls, 2);
});

test('different titles share request history but never their status result', async () => {
  const { api } = await fixture(); const calls = [];
  api.sendAPIRequest = async (method, endpoint) => {
    calls.push(endpoint);
    return endpoint.includes('/request?') ? { results: [] } : { id: Number(endpoint.split('/').pop()), mediaInfo: { status: 1 } };
  };
  const results = await Promise.all([1, 2].map(tmdbId => api.getMediaStatus({ tmdbId, mediaType: 'movie' })));
  assert.equal(calls.filter(path => path.includes('/request?')).length, 1);
  assert.equal(results[0].tmdbId, 1); assert.equal(results[1].tmdbId, 2);
});

test('write completion invalidates reads started before and during it, even on failure', async () => {
  const { api } = await fixture(); const writing = deferred(); let reads = 0, posts = 0;
  api.sendAPIRequest = async method => {
    if (method === 'POST') { posts++; await writing.promise; throw new Error('reply lost'); }
    return { value: ++reads };
  };
  await api.makeAPIRequest('GET', '/api/v1/request?take=100');
  const write = api.makeAPIRequest('POST', '/api/v1/request', {});
  await api.makeAPIRequest('GET', '/api/v1/request?take=100');
  writing.resolve(); await assert.rejects(write, /reply lost/);
  const fresh = await api.makeAPIRequest('GET', '/api/v1/request?take=100');
  assert.equal(fresh.value, 3); assert.equal(posts, 1);
});

test('settings change invalidates caches and old in-flight results cannot repopulate them', async () => {
  let server = 'https://one.example';
  const worker = loadWorker({ get: async () => ({ seerrUrl: server, seerrApiKey: 'k' }) });
  await worker.ready;
  const old = deferred(); let calls = 0;
  worker.api.sendAPIRequest = async () => { calls++; return calls === 1 ? old.promise : { server }; };
  const first = worker.api.makeAPIRequest('GET', '/api/v1/movie/1');
  await Promise.resolve(); server = 'https://two.example'; await worker.api.loadSettings();
  const second = await worker.api.makeAPIRequest('GET', '/api/v1/movie/1');
  old.resolve({ server: 'old' }); await assert.rejects(first, /site changed/);
  assert.equal(second.server, server);
  assert.equal((await worker.api.makeAPIRequest('GET', '/api/v1/movie/1')).server, server);
  assert.equal(calls, 2);
});

test('expired reads refetch, rejected reads retry, and cache size is bounded', async () => {
  const { api } = await fixture(); let calls = 0;
  const read = () => api.cachedSeerrRead('test', async () => ++calls);
  await read(); api.seerrReads.get('test').expiresAt = Date.now() - 1;
  assert.equal(await read(), 2);
  await assert.rejects(api.cachedSeerrRead('failed', async () => { throw new Error('offline'); }));
  assert.equal(await api.cachedSeerrRead('failed', async () => 'recovered'), 'recovered');
  for (let i = 0; i < 250; i++) await api.cachedSeerrRead(`key:${i}`, async () => i);
  assert.ok(api.seerrReads.size <= 200);
});

for (const change of ['server', 'key', 'switch-back']) {
  for (const stage of ['queued', 'in-flight']) {
    test(`cached reads reject a ${change} change while ${stage}`, async () => {
      const { api } = await fixture();
      const pending = deferred(); let calls = 0;
      api.sendAPIRequest = async () => { calls++; return pending.promise; };
      const first = api.makeAPIRequest('GET', '/api/v1/movie/1');
      const rejected = assert.rejects(first, /site changed/);
      if (stage === 'in-flight') await Promise.resolve();
      if (change === 'server') api.baseUrl = 'https://other.example';
      else if (change === 'key') api.apiKey = 'replacement';
      else api.connections = { revision: 2, activeId: api.baseUrl };
      api.invalidateSeerrReads();
      pending.resolve({ id: 1 });
      await rejected;
      assert.equal(calls, stage === 'queued' ? 0 : 1);
      assert.equal(api.seerrReads.size, 0);
      api.sendAPIRequest = async () => ({ id: 1, server: api.baseUrl, key: api.apiKey });
      const fresh = await api.makeAPIRequest('GET', '/api/v1/movie/1');
      assert.equal(fresh.server, api.baseUrl);
      assert.equal(fresh.key, api.apiKey);
    });
  }
}

test('a pending status cannot return the previous site status after a switch', async () => {
  const { api } = await fixture();
  const pending = deferred();
  api.getMediaStatusUncached = () => pending.promise;
  const first = api.getMediaStatus({ tmdbId: 1, mediaType: 'movie' });
  const rejected = assert.rejects(first, /site changed/);
  await Promise.resolve();
  api.baseUrl = 'https://other.example'; api.invalidateSeerrReads();
  pending.resolve({ status: 'available_watch' });
  await rejected;
  api.getMediaStatusUncached = async () => ({ status: 'available' });
  assert.equal((await api.getMediaStatus({ tmdbId: 1, mediaType: 'movie' })).status, 'available');
});

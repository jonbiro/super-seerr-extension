const { test } = require('node:test');
const assert = require('node:assert/strict');
const Config = require('../src/shared/RatingsConfig');
const { loadWorker } = require('./helpers/worker');

test('worker registers listeners immediately and delays messages until settings are loaded', async () => {
  let release;
  let calls = 0;
  const worker = loadWorker({ get: () => ++calls === 1 ? new Promise(resolve => { release = resolve; }) : Promise.resolve({ seerrUrl: 'https://seerr.example', seerrApiKey: 'test-key' }) });
  assert.equal(typeof worker.listeners.message, 'function');
  assert.equal(typeof worker.listeners.installed, 'function');
  worker.api.requestMedia = async () => ({ url: worker.api.baseUrl });
  let replied = false;
  const response = new Promise(resolve => {
    assert.equal(worker.listeners.message({ action: 'requestMedia', data: {} }, {}, result => { replied = true; resolve(result); }), true);
  });
  await Promise.resolve();
  assert.equal(replied, false);
  release({});
  assert.equal((await response).data.url, 'https://seerr.example');
});

test('worker migration preserves current settings including an intentionally empty API key', async () => {
  const worker = loadWorker({ get: async () => ({ seerrUrl: 'https://current.example', seerrApiKey: '', jellyseerrUrl: 'https://old.example', jellyseerrApiKey: 'old-key' }) });
  await worker.ready;
  assert.equal(worker.api.baseUrl, 'https://current.example');
  assert.equal(worker.api.apiKey, '');
  assert.equal(Object.keys(worker.writes[0]).length, 0);
  assert.equal(worker.removals[0].length, 2);
});

test('RT fetch resolves relative URLs and rejects other origins before network access', async () => {
  const calls = [];
  const worker = loadWorker({ fetch: async (url, options) => { calls.push({ url, options }); return { ok: true, text: async () => 'html' }; } });
  assert.equal(await worker.api.fetchRtHtml('/m/example'), 'html');
  assert.equal(calls[0].url, 'https://www.rottentomatoes.com/m/example');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.credentials, 'omit');
  for (const url of ['https://other.example/m/title', '//other.example/m/title', 'http://www.rottentomatoes.com/m/title', 'https://user:pass@www.rottentomatoes.com/m/title']) {
    await assert.rejects(worker.api.fetchRtHtml(url), /outside the allowed origin/);
  }
  assert.equal(calls.length, 1);
});

test('RT parser treats missing, invalid and out-of-range scores as absent; zero remains valid', () => {
  const { api } = loadWorker();
  for (const value of [null, '', 'N/A', 'bad', 101, -1]) {
    assert.equal(api.parseRtPercent(value), null);
  }
  const bundle = api.parseRtScorecard('<script id="media-scorecard-json">{"criticsScore":{"score":"N/A"},"audienceScore":{"score":0}}</script>');
  assert.equal(bundle.rtCriticsScore, null);
  assert.equal(bundle.rtAudienceScore, 0);
});

test('RT lookup works without Seerr config and uses central positive and negative cache TTLs', async () => {
  const { api } = loadWorker();
  let calls = 0;
  api.fetchRtHtml = async () => { calls++; return ''; };
  api.parseRtSearchResults = () => [{ href: '/m/example', title: 'Example', year: 2020, rtCriticsScore: 80 }];
  api.parseRtScorecard = () => ({ rtAudienceScore: 90 });
  const start = Date.now();
  const result = await api.getRottenTomatoesRatings({ title: 'Example', year: 2020 });
  assert.equal(result.rtAudienceScore, 90);
  assert.equal(result.rtCriticsScore, 80);
  // Exact title, exact year: full confidence, so the badge is not marked
  // approximate. This used to cap at 0.97, which marked every score ever shown.
  assert.equal(result.confidence, 1);
  await api.getRottenTomatoesRatings({ title: 'Example', year: 2020 });
  assert.equal(calls, 2);
  assert.ok(api.rtCache.get('movie:Example:2020').expiresAt >= start + Config.rtCacheTtlMs);
  api.parseRtSearchResults = () => [];
  assert.equal(await api.getRottenTomatoesRatings({ title: 'Absent' }), null);
  assert.ok(api.rtCache.get('movie:Absent:').expiresAt >= start + Config.rtNegativeCacheTtlMs);
});

test('worker coalesces RT calls across callers and retries after rejection', async () => {
  const { api } = loadWorker();
  let calls = 0, release;
  api.resolveRottenTomatoesRatings = () => { calls++; return new Promise(resolve => { release = resolve; }); };
  const requests = Array.from({ length: 8 }, () => api.getRottenTomatoesRatings({ title: 'Same' }));
  assert.equal(calls, 1);
  release({ rtCriticsScore: 80 });
  await Promise.all(requests);
  api.resolveRottenTomatoesRatings = async () => { throw new Error('network'); };
  await assert.rejects(api.getRottenTomatoesRatings({ title: 'Retry' }), /network/);
  api.resolveRottenTomatoesRatings = async () => ({ rtCriticsScore: 90 });
  assert.equal((await api.getRottenTomatoesRatings({ title: 'Retry' })).rtCriticsScore, 90);
});

test('temporary connection tests do not replace saved worker settings', async () => {
  const requests = [];
  const { api, ready } = loadWorker({
    get: async () => ({ seerrUrl: 'https://saved.example', seerrApiKey: 'saved-key' }),
    fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => ({ displayName: 'Tester' }) }; }
  });
  await ready;
  const result = await new Promise(resolve => api.handleMessage({ action: 'testConnection', data: { seerrUrl: 'https://test.example', seerrApiKey: 'temporary' } }, {}, resolve));
  assert.equal(result.success, true);
  assert.equal(api.baseUrl, 'https://saved.example');
  assert.equal(api.apiKey, 'saved-key');
  // loadSettings also reads /settings/public, so find the connection test's
  // own request rather than assuming it is first.
  const authRequest = requests.find(entry => entry.url.endsWith('/api/v1/auth/me'));
  assert.ok(authRequest, `expected an auth/me request, saw ${requests.map(r => r.url).join(', ')}`);
  assert.equal(authRequest.url, 'https://test.example/api/v1/auth/me');
  assert.equal(authRequest.options.headers['X-Api-Key'], 'temporary');
  assert.ok(authRequest.options.signal);
  assert.equal(authRequest.options.redirect, 'error');
});

test('RT cache remains bounded when distinct lookups finish concurrently', async () => {
  const { api } = loadWorker();
  api.fetchRtHtml = async () => '';
  api.parseRtSearchResults = () => [];
  await Promise.all(Array.from({ length: Config.rtCacheMaxEntries + 20 }, (_, i) => api.getRottenTomatoesRatings({ title: `Title ${i}` })));
  assert.equal(api.rtCache.size, Config.rtCacheMaxEntries);
  assert.equal(api.rtPending.size, 0);
});

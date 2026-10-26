const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const sender = { url: 'chrome-extension://fixture/src/options/options.html' };
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const reply = (data, headers = {}) => new Response(JSON.stringify(data), { headers });
const tokens = (suffix = '') => ({ access_token: `access-secret${suffix}`, refresh_token: `refresh-secret${suffix}`, token_type: 'Bearer', expires_in: 3600 });
const account = extra => ({ clientId: 'app-id', accessToken: 'access-secret', refreshToken: 'refresh-secret', expiresAt: Date.now() + 3600000, ...extra });

function load({ accounts = {}, session = {}, fetch = async () => reply(tokens()), launch, permission = true } = {}) {
  const local = { trackerAccountsV1: structuredClone(accounts) }, requests = [], flows = [];
  const context = vm.createContext({
    URL, URLSearchParams, TextEncoder, TextDecoder, Uint8Array, crypto: webcrypto, btoa, AbortSignal,
    fetch: async (url, options) => { requests.push({ url: String(url), options }); return fetch(String(url), options); },
    chrome: {
      runtime: { getURL: path => `chrome-extension://fixture/${path}`, getManifest: () => ({ version: '3.5.240' }) },
      identity: {
        getRedirectURL: path => `https://fixture.chromiumapp.org/${path}`,
        launchWebAuthFlow: async options => {
          flows.push(options);
          const url = new URL(options.url);
          if (launch) return launch(url);
          const callback = new URL(url.searchParams.get('redirect_uri'));
          callback.searchParams.set('code', 'authorization-code');
          callback.searchParams.set('state', url.searchParams.get('state'));
          if (url.hostname === 'simkl.com') callback.searchParams.set('iss', 'https://simkl.com');
          return callback.href;
        }
      },
      permissions: { contains: async () => permission },
      storage: { local: { get: async () => structuredClone(local), set: async value => Object.assign(local, structuredClone(value)) },
        session: { get: async () => structuredClone(session), set: async value => Object.assign(session, structuredClone(value)),
          remove: async keys => { for (const key of [].concat(keys)) delete session[key]; } } }
    }
  });
  vm.runInContext(fs.readFileSync('src/background/TrackerAccounts.js', 'utf8'), context);
  const api = Object.assign({ requireExtensionPage(value) {
    if (!value?.url?.startsWith('chrome-extension://fixture/')) throw new Error('Extension pages only');
  } }, context.TrackerAccounts);
  return { api, context, local, session, requests, flows, call: (action, data) => api.trackerOperation(action, data, sender) };
}

test('all tracker actions reject content scripts and unknown providers', async () => {
  const f = load();
  for (const action of ['getTrackerAccounts', 'saveTrackerApp', 'connectTracker', 'disconnectTracker', 'getTrackerWatchlist']) {
    await assert.rejects(f.api.trackerOperation(action, { provider: 'trakt', clientId: 'app' }, { url: 'https://trakt.tv/movies/dune' }), /Extension pages only/);
  }
  for (const provider of ['__proto__', 'constructor', null, 'other']) await assert.rejects(f.call('connectTracker', { provider }), /supported tracker/);
  assert.equal(f.requests.length, 0);
});

test('public metadata contains client setup and callbacks without exposing local tokens', async () => {
  const f = load({ accounts: { trakt: account() } });
  const rows = await f.call('getTrackerAccounts');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].connected, true);
  assert.equal(rows[0].clientId, 'app-id');
  assert.equal(rows[0].callbackUrl, 'https://fixture.chromiumapp.org/tracker/trakt');
  assert.ok(!JSON.stringify(rows).includes('secret'));
});

for (const provider of ['trakt', 'simkl']) test(`${provider} uses PKCE, exact callback, and public-client token exchange`, async () => {
  const f = load();
  await f.call('saveTrackerApp', { provider, clientId: 'app-id' });
  const rows = await f.call('connectTracker', { provider });
  assert.equal(rows.find(row => row.provider === provider).connected, true);
  const auth = new URL(f.flows[0].url);
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  assert.match(auth.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
  assert.match(auth.searchParams.get('state'), /^[a-f0-9]{64}$/);
  assert.equal(auth.searchParams.get('redirect_uri'), `https://fixture.chromiumapp.org/tracker/${provider}`);
  assert.equal(auth.hostname, provider === 'trakt' ? 'auth.trakt.tv' : 'simkl.com');
  const request = f.requests[0];
  assert.equal(request.url, provider === 'trakt' ? 'https://auth.trakt.tv/oauth/token' : 'https://api.simkl.com/oauth2/token');
  const body = provider === 'trakt' ? JSON.parse(request.options.body) : Object.fromEntries(new URLSearchParams(request.options.body));
  assert.equal(body.grant_type, 'authorization_code');
  assert.equal(body.client_id, 'app-id');
  assert.match(body.code_verifier, /^[a-f0-9]{64}$/);
  assert.equal(body.client_secret, undefined);
  assert.ok(!JSON.stringify(rows).includes('secret'));
});

for (const kind of ['host', 'path', 'state', 'duplicate state', 'fragment', 'issuer', 'duplicate code', 'denied']) test(`forged or denied OAuth callback (${kind}) never exchanges a token`, async () => {
  const f = load({ accounts: { simkl: { clientId: 'app-id' } }, launch: async auth => {
    const url = new URL(auth.searchParams.get('redirect_uri'));
    url.searchParams.set('state', auth.searchParams.get('state'));
    url.searchParams.set('code', 'code'); url.searchParams.set('iss', 'https://simkl.com');
    if (kind === 'host') url.hostname = 'attacker.example';
    if (kind === 'path') url.pathname += '/wrong';
    if (kind === 'state') url.searchParams.set('state', 'wrong');
    if (kind === 'duplicate state') url.searchParams.append('state', 'wrong');
    if (kind === 'fragment') url.hash = 'code=forged';
    if (kind === 'issuer') url.searchParams.set('iss', 'https://attacker.example');
    if (kind === 'duplicate code') url.searchParams.append('code', 'forged');
    if (kind === 'denied') url.searchParams.set('error', 'access_denied');
    return url.href;
  } });
  await assert.rejects(f.call('connectTracker', { provider: 'simkl' }), /invalid|denied/);
  assert.equal(f.requests.length, 0);
  assert.equal(f.local.trackerAccountsV1.simkl.accessToken, undefined);
});

test('client IDs and pages are validated before remote requests', async () => {
  const f = load();
  for (const clientId of ['', ' ', '\n', 'with space', 'a'.repeat(257), 1, null]) await assert.rejects(f.call('saveTrackerApp', { provider: 'trakt', clientId }), /valid application client ID/);
  for (const page of [0, 6, '1', 1.5, [], null]) {
    if (page === null) continue;
    await assert.rejects(f.call('getTrackerWatchlist', { provider: 'trakt', page }), /watchlist page/);
  }
  assert.equal(f.requests.length, 0);
});

test('missing provider permission blocks connection before opening OAuth', async () => {
  const f = load({ accounts: { trakt: { clientId: 'app' } }, permission: false });
  await assert.rejects(f.call('connectTracker', { provider: 'trakt' }), /Grant Trakt access/);
  assert.equal(f.flows.length, 0);
});

for (const mutation of ['disconnectTracker', 'saveTrackerApp']) test(`${mutation} invalidates an outstanding authorization callback`, async () => {
  const pending = gate();
  const f = load({ accounts: { trakt: { clientId: 'app' } }, launch: auth => pending.promise.then(() => {
    const url = new URL(auth.searchParams.get('redirect_uri'));
    url.searchParams.set('state', auth.searchParams.get('state')); url.searchParams.set('code', 'old-code'); return url.href;
  }) });
  const connect = f.call('connectTracker', { provider: 'trakt' });
  while (!f.flows.length) await new Promise(resolve => setImmediate(resolve));
  await f.call(mutation, { provider: 'trakt', clientId: 'replacement-app' });
  pending.resolve(); await assert.rejects(connect, /account changed/);
  assert.equal(f.requests.length, 0);
  assert.equal(f.local.trackerAccountsV1.trakt.accessToken, undefined);
});

test('disconnect while preparing PKCE prevents opening a superseded authorization popup', async () => {
  const pending = gate(); let started = false;
  const f = load({ accounts: { trakt: { clientId: 'app-id' } } });
  f.context.crypto = { getRandomValues: bytes => webcrypto.getRandomValues(bytes), subtle: { digest: () => { started = true; return pending.promise; } } };
  const connecting = f.call('connectTracker', { provider: 'trakt' });
  while (!started) await new Promise(resolve => setImmediate(resolve));
  await f.call('disconnectTracker', { provider: 'trakt' });
  pending.resolve(new Uint8Array(32).buffer);
  await assert.rejects(connecting, /account changed/);
  assert.equal(f.flows.length, 0);
});

test('Trakt watchlist reads normalize movie/show identity, honor server pagination, and never write server data', async () => {
  const f = load({ accounts: { trakt: account() }, fetch: async () => reply([
    { type: 'movie', movie: { title: 'Dune', year: 2021, ids: { tmdb: '438631', imdb: 'tt1160419' } } },
    { type: 'show', show: { title: 'Dark', year: 2017, ids: { tmdb: 70523 } } },
    { type: 'episode', show: { title: 'Dark', year: 2017 } },
    { type: 'movie', movie: { title: '<b>Text title</b>', year: null, ids: { tmdb: '1junk', imdb: 'https://example.com' } } }
  ], { 'X-Pagination-Page': '1', 'X-Pagination-Page-Count': '3' }) });
  const result = await f.call('getTrackerWatchlist', { provider: 'trakt' });
  assert.equal(result.items.length, 3);
  assert.equal(result.items[0].tmdbId, 438631);
  assert.equal(result.items[1].mediaType, 'tv');
  assert.equal(result.items[2].tmdbId, undefined);
  assert.equal(result.skipped, 1); assert.equal(result.nextPage, 2);
  assert.equal(f.requests[0].options.method, 'GET');
  assert.equal(f.requests[0].options.headers.Authorization, 'Bearer access-secret');
  assert.equal(f.requests[0].options.headers['trakt-api-key'], 'app-id');
  assert.ok(f.local.trackerAccountsV1.trakt.lastSyncAt > 0);
  assert.ok(!JSON.stringify(result).includes('secret'));
});

test('Trakt combined watchlist reads movies and shows through its documented paginated route', async () => {
  // Contract: trakt/trakt-api, projects/api/src/contracts/users/subroutes/watchlist.ts,
  // `all.path` is `/movie,show/:sort`; individual resources are `/movies` and `/shows`.
  const f = load({ accounts: { trakt: account() }, fetch: async value => {
    const url = new URL(value), page = Number(url.searchParams.get('page'));
    if (url.pathname !== '/users/me/watchlist/movie,show/added') return new Response('Unknown watchlist route', { status: 404 });
    if (url.searchParams.get('limit') !== '100' || ![1, 2].includes(page)) return new Response('Invalid pagination', { status: 400 });
    return reply(page === 1
      ? [{ type: 'movie', movie: { title: 'Dune', year: 2021, ids: { tmdb: 438631 } } }]
      : [{ type: 'show', show: { title: 'Dark', year: 2017, ids: { tmdb: 70523 } } }], {
      'X-Pagination-Page': String(page), 'X-Pagination-Page-Count': '2'
    });
  } });
  const first = await f.call('getTrackerWatchlist', { provider: 'trakt' });
  assert.equal(first.items[0].mediaType, 'movie');
  assert.equal(first.items[0].title, 'Dune');
  assert.equal(first.nextPage, 2);
  const second = await f.call('getTrackerWatchlist', { provider: 'trakt', page: first.nextPage });
  assert.equal(second.items[0].mediaType, 'tv');
  assert.equal(second.items[0].title, 'Dark');
  assert.equal(second.hasMore, false);
  assert.equal(f.requests.length, 2);
  assert.ok(f.requests.every(request => request.options.method === 'GET'));
});

test('disconnect during watchlist fetch rejects the stale list and its sync stamp', async () => {
  const pending = gate();
  const f = load({ accounts: { trakt: account() }, fetch: () => pending.promise });
  const read = f.call('getTrackerWatchlist', { provider: 'trakt' });
  while (!f.requests.length) await new Promise(resolve => setImmediate(resolve));
  await f.call('disconnectTracker', { provider: 'trakt' });
  pending.resolve(reply([], { 'X-Pagination-Page': '1', 'X-Pagination-Page-Count': '0' }));
  await assert.rejects(read, /account changed/);
  assert.equal(f.local.trackerAccountsV1.trakt.lastSyncAt, undefined);
  assert.equal(f.local.trackerAccountsV1.trakt.accessToken, undefined);
});

test('concurrent expired-token reads coalesce one rotating refresh', async () => {
  const pending = gate();
  const f = load({ accounts: { trakt: account({ expiresAt: 1 }) }, fetch: async (url, options) => options.method === 'POST'
    ? pending.promise : reply([], { 'X-Pagination-Page': '1', 'X-Pagination-Page-Count': '0' }) });
  const a = f.call('getTrackerWatchlist', { provider: 'trakt' });
  const b = f.call('getTrackerWatchlist', { provider: 'trakt' });
  while (!f.requests.length) await new Promise(resolve => setImmediate(resolve));
  pending.resolve(reply(tokens('-rotated')));
  await Promise.all([a, b]);
  assert.equal(f.requests.filter(row => row.options.method === 'POST').length, 1);
  assert.equal(f.local.trackerAccountsV1.trakt.refreshToken, 'refresh-secret-rotated');
});

test('Simkl imports only planned movies and shows, pages locally, and checks activities before pulls', async () => {
  const rows = Array.from({ length: 101 }, (_, i) => ({ status: 'plantowatch', movie: { title: `Film ${i}`, year: '2021', ids: { tmdb: String(i + 1) } } }));
  rows.push({ status: 'watching', movie: { title: 'Already watching' } });
  const f = load({ accounts: { simkl: account() }, fetch: async url => url.includes('/sync/activities') ? reply({ all: '2026-10-25T00:00:00Z' })
    : url.includes('/movies/') ? reply({ movies: rows }) : reply({ shows: [{ status: 'plantowatch', show: { title: 'Dark', year: 2017 } }] }) });
  const first = await f.call('getTrackerWatchlist', { provider: 'simkl' });
  assert.equal(first.items.length, 100); assert.equal(first.skipped, 1); assert.equal(first.nextPage, 2);
  const second = await f.call('getTrackerWatchlist', { provider: 'simkl', page: 2, snapshotId: first.snapshotId });
  assert.equal(second.items.length, 2); assert.equal(second.nextPage, null);
  assert.equal(f.requests.length, 4);
  assert.ok(f.requests[0].url.includes('/sync/activities?'));
  for (const row of f.requests) {
    const url = new URL(row.url);
    assert.equal(url.searchParams.get('client_id'), 'app-id');
    assert.equal(url.searchParams.get('app-name'), 'Super Seerr');
    assert.equal(row.options.method, 'GET');
  }
  await f.call('getTrackerWatchlist', { provider: 'simkl' });
  assert.equal(f.requests.length, 5, 'unchanged activities avoid another full pull');
});

test('Simkl empty objects are valid while malformed lists cannot advance last sync', async () => {
  let malformed = true;
  const f = load({ accounts: { simkl: account() }, fetch: async url => url.includes('/activities') ? reply({ all: null })
    : reply(malformed ? { movies: 'wrong', shows: 'wrong' } : {}) });
  await assert.rejects(f.call('getTrackerWatchlist', { provider: 'simkl' }), /invalid watchlist/);
  assert.equal(f.local.trackerAccountsV1.simkl.lastSyncAt, undefined);
  malformed = false;
  const result = await f.call('getTrackerWatchlist', { provider: 'simkl' });
  assert.equal(result.items.length, 0);
  const fullReads = () => f.requests.filter(request => request.url.includes('/sync/all-items/')).length;
  const requests = fullReads();
  const repeat = await f.call('getTrackerWatchlist', { provider: 'simkl' });
  assert.equal(repeat.items.length, 0);
  assert.equal(fullReads(), requests, 'a valid null activity marker reuses an empty snapshot');
});

test('two open Simkl reviews keep their own pagination after one window syncs a changed list', async () => {
  let revision = 'Earlier';
  const f = load({ accounts: { simkl: account({ accountRevision: 'same-account' }) }, fetch: async url => url.includes('/activities') ? reply({ all: revision })
    : url.includes('/movies/') ? reply({ movies: Array.from({ length: 150 }, (_, i) => ({ status: 'plantowatch', movie: { title: `${revision} film ${i}`, year: 2020 } })) }) : reply({}) });
  const earlier = await f.call('getTrackerWatchlist', { provider: 'simkl' });
  revision = 'Later';
  const later = await f.call('getTrackerWatchlist', { provider: 'simkl' });
  const earlierMore = await f.call('getTrackerWatchlist', { provider: 'simkl', page: 2, snapshotId: earlier.snapshotId });
  assert.equal(earlierMore.items[0].title, 'Earlier film 100');
  const laterMore = await f.call('getTrackerWatchlist', { provider: 'simkl', page: 2, snapshotId: later.snapshotId });
  assert.equal(laterMore.items[0].title, 'Later film 100');
  assert.notEqual(earlier.snapshotId, later.snapshotId);
  assert.equal(f.requests.length, 8, 'pagination uses the review snapshots without another provider pull');
});

test('Simkl review pagination survives a worker restart without downloading the provider feeds again', async () => {
  const f = load({ accounts: { simkl: account({ accountRevision: 'same-account' }) }, fetch: async url => url.includes('/activities') ? reply({ all: 'first' })
    : url.includes('/movies/') ? reply({ movies: Array.from({ length: 150 }, (_, i) => ({ status: 'plantowatch', movie: { title: `Film ${i}` } })) }) : reply({}) });
  const first = await f.call('getTrackerWatchlist', { provider: 'simkl' });
  const restarted = load({ accounts: f.local.trackerAccountsV1, session: f.session, fetch: async () => { throw new Error('Pagination should use the saved session snapshot'); } });
  const more = await restarted.call('getTrackerWatchlist', { provider: 'simkl', page: 2, snapshotId: first.snapshotId });
  assert.equal(more.items[0].title, 'Film 100');
  assert.equal(more.items.length, 50);
  assert.equal(restarted.requests.length, 0);
});

test('Simkl pagination keeps the same account review through a rotating token refresh', async () => {
  const f = load({ accounts: { simkl: account({ accountRevision: 'same-account' }) }, fetch: async (url, options) => options.method === 'POST' ? reply(tokens('-rotated'))
    : url.includes('/activities') ? reply({ all: 'first' }) : url.includes('/movies/') ? reply({ movies: Array.from({ length: 150 }, (_, i) => ({ status: 'plantowatch', movie: { title: `Film ${i}` } })) }) : reply({}) });
  const first = await f.call('getTrackerWatchlist', { provider: 'simkl' });
  f.local.trackerAccountsV1.simkl.expiresAt = 1;
  const refreshed = await f.call('getTrackerWatchlist', { provider: 'simkl' });
  assert.equal(refreshed.snapshotId, first.snapshotId);
  const more = await f.call('getTrackerWatchlist', { provider: 'simkl', page: 2, snapshotId: first.snapshotId });
  assert.equal(more.items[0].title, 'Film 100');
  assert.equal(more.snapshotId, first.snapshotId);
  assert.equal(f.requests.length, 6, 'only token refresh and an activity check are added by another Sync');
  assert.ok(!JSON.stringify(f.session).includes('secret'), 'session snapshots do not duplicate credentials');
});

test('a new Simkl account cannot read a previous account snapshot, including after a worker restart', async () => {
  const f = load({ accounts: { simkl: account({ accountRevision: 'previous-account' }) }, fetch: async url => url.includes('/activities') ? reply({ all: 'first' })
    : url.includes('/movies/') ? reply({ movies: Array.from({ length: 150 }, (_, i) => ({ status: 'plantowatch', movie: { title: `Private film ${i}` } })) }) : reply({}) });
  const first = await f.call('getTrackerWatchlist', { provider: 'simkl' });
  const different = load({ accounts: { simkl: account({ accountRevision: 'different-account' }) }, session: f.session });
  await assert.rejects(different.call('getTrackerWatchlist', { provider: 'simkl', page: 2, snapshotId: first.snapshotId }), /no longer available.*Sync watchlist/);
  assert.equal(different.requests.length, 0);
  await f.call('disconnectTracker', { provider: 'simkl' });
  assert.deepEqual(f.session, {}, 'disconnect removes retained private reviews');
});

test('Simkl review retention is bounded and evicted reviews fail explicitly instead of mixing pages', async () => {
  let revision = 0;
  const f = load({ accounts: { simkl: account({ accountRevision: 'same-account' }) }, fetch: async url => url.includes('/activities') ? reply({ all: String(revision) })
    : url.includes('/movies/') ? reply({ movies: Array.from({ length: 101 }, (_, i) => ({ status: 'plantowatch', movie: { title: `Revision ${revision} film ${i}` } })) }) : reply({}) });
  const reviews = [];
  for (; revision < 12; revision++) reviews.push(await f.call('getTrackerWatchlist', { provider: 'simkl' }));
  await assert.rejects(f.call('getTrackerWatchlist', { provider: 'simkl', page: 2, snapshotId: reviews[0].snapshotId }), /no longer available.*Sync watchlist/);
  const retained = await f.call('getTrackerWatchlist', { provider: 'simkl', page: 2, snapshotId: reviews[2].snapshotId });
  assert.equal(retained.items[0].title, 'Revision 2 film 100');
  const newest = await f.call('getTrackerWatchlist', { provider: 'simkl', page: 2, snapshotId: reviews[11].snapshotId });
  assert.equal(newest.items[0].title, 'Revision 11 film 100');
  assert.ok(Buffer.byteLength(JSON.stringify(f.session)) <= 2 * 1024 * 1024);
});

test('Simkl review continuations require a valid snapshot before any permission or network work', async () => {
  const f = load({ accounts: { simkl: account() } });
  f.context.chrome.permissions.contains = async () => { throw new Error('Invalid pagination should be rejected first'); };
  for (const snapshotId of [undefined, null, '', '__proto__', {}, 1]) {
    await assert.rejects(f.call('getTrackerWatchlist', { provider: 'simkl', page: 2, snapshotId }), /Sync watchlist/);
  }
  assert.equal(f.requests.length, 0);
});

test('disconnect retires a Simkl snapshot while its session write is pending', async () => {
  const pending = gate(); let writing = false;
  const f = load({ accounts: { simkl: account({ accountRevision: 'same-account' }) }, fetch: async url => url.includes('/activities') ? reply({ all: 'first' })
    : url.includes('/movies/') ? reply({ movies: [{ status: 'plantowatch', movie: { title: 'Retired private film' } }] }) : reply({}) });
  const set = f.context.chrome.storage.session.set;
  f.context.chrome.storage.session.set = async value => { writing = true; await pending.promise; await set(value); };
  const reading = f.call('getTrackerWatchlist', { provider: 'simkl' }).then(() => null, error => error);
  while (!writing) await new Promise(resolve => setImmediate(resolve));
  const disconnecting = f.call('disconnectTracker', { provider: 'simkl' });
  pending.resolve();
  const error = await reading; await disconnecting;
  assert.match(error?.message || '', /account changed/);
  assert.equal(f.local.trackerAccountsV1.simkl.accessToken, undefined);
  assert.deepEqual(f.session, {});
});

test('cached Simkl pages work offline without refreshing expired tokens or advancing Last synced', async () => {
  const f = load({ accounts: { simkl: account({ accountRevision: 'same-account' }) }, fetch: async url => url.includes('/activities') ? reply({ all: 'first' })
    : url.includes('/movies/') ? reply({ movies: Array.from({ length: 150 }, (_, i) => ({ status: 'plantowatch', movie: { title: `Film ${i}` } })) }) : reply({}) });
  const first = await f.call('getTrackerWatchlist', { provider: 'simkl' });
  f.local.trackerAccountsV1.simkl.expiresAt = 1;
  f.context.chrome.permissions.contains = async () => { throw new Error('Cached pagination must not contact the provider'); };
  const more = await f.call('getTrackerWatchlist', { provider: 'simkl', page: 2, snapshotId: first.snapshotId });
  assert.equal(more.items[0].title, 'Film 100');
  assert.equal(more.lastSyncAt, first.lastSyncAt);
  assert.equal(f.local.trackerAccountsV1.simkl.lastSyncAt, first.lastSyncAt);
  assert.equal(f.requests.length, 4);
  assert.equal(f.local.trackerAccountsV1.simkl.accessToken, 'access-secret');
});

test('multibyte Simkl snapshots respect the byte budget while keeping the newest review intact', async () => {
  let revision = 0;
  const f = load({ accounts: { simkl: account({ accountRevision: 'same-account' }) }, fetch: async url => url.includes('/activities') ? reply({ all: String(revision) })
    : url.includes('/movies/') ? reply({ movies: Array.from({ length: 500 }, (_, i) => ({ status: 'plantowatch', movie: { title: `${'映'.repeat(290)} ${revision} ${i}` } })) }) : reply({}) });
  const reviews = [];
  for (; revision < 6; revision++) reviews.push(await f.call('getTrackerWatchlist', { provider: 'simkl' }));
  assert.ok(Buffer.byteLength(JSON.stringify(f.session)) <= 2 * 1024 * 1024);
  await assert.rejects(f.call('getTrackerWatchlist', { provider: 'simkl', page: 2, snapshotId: reviews[0].snapshotId }), /no longer available/);
  const newest = await f.call('getTrackerWatchlist', { provider: 'simkl', page: 5, snapshotId: reviews[5].snapshotId });
  assert.equal(newest.items.length, 100);
  assert.equal(newest.items[99].title, `${'映'.repeat(290)} 5 499`);
});

test('corrupt retained rows invalidate a whole Simkl review instead of shifting its page boundaries', async () => {
  const f = load({ accounts: { simkl: account({ accountRevision: 'same-account' }) }, fetch: async url => url.includes('/activities') ? reply({ all: 'first' })
    : url.includes('/movies/') ? reply({ movies: Array.from({ length: 150 }, (_, i) => ({ status: 'plantowatch', movie: { title: `Film ${i}` } })) }) : reply({}) });
  const first = await f.call('getTrackerWatchlist', { provider: 'simkl' });
  f.session.simklWatchlistSnapshotsV1.snapshots[0].items[0].title = null;
  await assert.rejects(f.call('getTrackerWatchlist', { provider: 'simkl', page: 2, snapshotId: first.snapshotId }), /no longer available.*Sync watchlist/);
  assert.equal(f.requests.length, 4);
});

test('a cached Simkl page preserves a newer sync stamp committed while its session read is pending', async () => {
  const f = load({ accounts: { simkl: account({ accountRevision: 'same-account' }) }, fetch: async url => url.includes('/activities') ? reply({ all: 'first' })
    : url.includes('/movies/') ? reply({ movies: Array.from({ length: 150 }, (_, i) => ({ status: 'plantowatch', movie: { title: `Film ${i}` } })) }) : reply({}) });
  const first = await f.call('getTrackerWatchlist', { provider: 'simkl' });
  const get = f.context.chrome.storage.session.get;
  let release;
  f.context.chrome.storage.session.get = () => new Promise(resolve => { release = async () => resolve(await get()); });
  const reading = f.call('getTrackerWatchlist', { provider: 'simkl', page: 2, snapshotId: first.snapshotId });
  while (!release) await new Promise(resolve => setImmediate(resolve));
  f.local.trackerAccountsV1.simkl.lastSyncAt = first.lastSyncAt + 5000;
  await release();
  const more = await reading;
  assert.equal(more.lastSyncAt, first.lastSyncAt + 5000);
  assert.equal(f.local.trackerAccountsV1.simkl.lastSyncAt, more.lastSyncAt);
});

for (const replaceAccount of [false, true]) test(`a credential update queued during cached pagination respects account identity (replacement: ${replaceAccount})`, async () => {
  const f = load({ accounts: { simkl: account({ accountRevision: 'same-account' }) }, fetch: async url => url.includes('/activities') ? reply({ all: 'first' })
    : url.includes('/movies/') ? reply({ movies: Array.from({ length: 150 }, (_, i) => ({ status: 'plantowatch', movie: { title: `Film ${i}` } })) }) : reply({}) });
  const first = await f.call('getTrackerWatchlist', { provider: 'simkl' });
  const get = f.context.chrome.storage.session.get;
  let updating;
  f.context.chrome.storage.session.get = async () => {
    const stored = await get();
    updating = f.api.commitTracker('simkl', f.api.trackerEpoch('simkl'), current => ({ ...current,
      accessToken: 'rotated-access', refreshToken: 'rotated-refresh',
      accountRevision: replaceAccount ? 'different-account' : current.accountRevision }));
    return stored;
  };
  const reading = f.call('getTrackerWatchlist', { provider: 'simkl', page: 2, snapshotId: first.snapshotId });
  if (replaceAccount) await assert.rejects(reading, /account changed/);
  else {
    const more = await reading;
    assert.equal(more.items[0].title, 'Film 100');
    assert.equal(more.snapshotId, first.snapshotId);
  }
  await updating;
});

test('provider errors never echo response bodies or tokens', async () => {
  const f = load({ accounts: { trakt: account() }, fetch: async () => new Response('access-secret refresh-secret', { status: 401 }) });
  await assert.rejects(f.call('getTrackerWatchlist', { provider: 'trakt' }), error => /HTTP 401/.test(error.message) && !error.message.includes('secret'));
});

test('rate-limited tracker reads honor Retry-After without automatic retries', async () => {
  const f = load({ accounts: { trakt: account() }, fetch: async () => new Response('access-secret', { status: 429, headers: { 'Retry-After': '45' } }) });
  await assert.rejects(f.call('getTrackerWatchlist', { provider: 'trakt' }), /Try again in 45 seconds/);
  await assert.rejects(f.call('getTrackerWatchlist', { provider: 'trakt' }), /rate limited/);
  assert.equal(f.requests.length, 1);
  assert.equal(f.local.trackerAccountsV1.trakt.lastSyncAt, undefined);
});

test('cross-provider app changes preserve the other account and its credentials', async () => {
  const f = load({ accounts: { trakt: account(), simkl: account() } });
  await Promise.all([f.call('saveTrackerApp', { provider: 'trakt', clientId: 'new-trakt' }), f.call('disconnectTracker', { provider: 'simkl' })]);
  assert.equal(f.local.trackerAccountsV1.trakt.clientId, 'new-trakt');
  assert.equal(f.local.trackerAccountsV1.simkl.clientId, 'app-id');
  assert.equal(f.local.trackerAccountsV1.simkl.accessToken, undefined);
});

test('Simkl anime retains verified movie/TV type without trusting an untyped parent TMDB id', async () => {
  const f = load({ accounts: { simkl: account() }, fetch: async url => url.includes('/activities') ? reply({ all: null })
    : url.includes('/anime/') ? reply({ anime: [
      { status: 'plantowatch', anime_type: 'movie', show: { title: 'Wings of Freedom', year: 2015, ids: { tmdb: '1429', imdb: 'tt3646944' } } },
      { status: 'plantowatch', anime_type: 'tv', show: { title: 'Attack on Titan', year: 2013, ids: { tmdb: '1429' } } },
      { status: 'plantowatch', anime_type: 'ova', show: { title: 'Episode collection' } },
      { status: 'plantowatch', anime_type: 'movie', show: { title: 'Coerced year', year: [2015] } },
      { status: 'completed', anime_type: 'movie', show: { title: 'Already watched' } }
    ] }) : reply({}) });
  const result = await f.call('getTrackerWatchlist', { provider: 'simkl' });
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].mediaType, 'movie');
  assert.equal(result.items[0].tmdbId, undefined);
  assert.equal(result.items[0].imdbId, 'tt3646944');
  assert.equal(result.items[1].mediaType, 'tv');
  assert.equal(result.skipped, 3);
});

test('provider response bodies are bounded by announced and streamed byte size', async () => {
  for (const announced of [true, false]) {
    let cancelled = false;
    const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } });
    const f = load({ accounts: { trakt: account() }, fetch: async () => new Response(stream, { headers: announced ? { 'Content-Length': String(3 * 1024 * 1024) } : {} }) });
    await assert.rejects(f.call('getTrackerWatchlist', { provider: 'trakt' }), /too many items/);
    assert.equal(cancelled, true);
    assert.equal(f.local.trackerAccountsV1.trakt.lastSyncAt, undefined);
  }
});

test('tracker response bodies cancel when a stream fails mid-read', async () => {
  let cancelled = false;
  const body = {
    getReader() {
      return {
        async read() { throw new Error('body interrupted'); },
        async cancel() { cancelled = true; },
        releaseLock() {}
      };
    }
  };
  const f = load({ accounts: { trakt: account() }, fetch: async () => ({
    ok: true, status: 200, headers: new Headers({ 'X-Pagination-Page': '1', 'X-Pagination-Page-Count': '0' }), body
  }) });
  await assert.rejects(f.call('getTrackerWatchlist', { provider: 'trakt' }), /unreadable response/);
  assert.equal(cancelled, true);
});

test('disconnect during rotating refresh cannot restore credentials', async () => {
  const pending = gate();
  const f = load({ accounts: { trakt: account({ expiresAt: 1 }) }, fetch: () => pending.promise });
  const read = f.call('getTrackerWatchlist', { provider: 'trakt' });
  while (!f.requests.length) await new Promise(resolve => setImmediate(resolve));
  await f.call('disconnectTracker', { provider: 'trakt' });
  pending.resolve(reply(tokens('-rotated')));
  await assert.rejects(read, /account changed/);
  assert.equal(f.local.trackerAccountsV1.trakt.accessToken, undefined);
  assert.equal(f.requests.length, 1);
});

test('saving an unchanged app during a rotating refresh preserves the refreshed credentials', async () => {
  const pending = gate();
  const f = load({ accounts: { trakt: account({ expiresAt: 1, accountRevision: 'original' }) }, fetch: async (url, options) => options.method === 'POST'
    ? pending.promise : reply([], { 'X-Pagination-Page': '1', 'X-Pagination-Page-Count': '0' }) });
  const read = f.call('getTrackerWatchlist', { provider: 'trakt' });
  while (!f.requests.length) await new Promise(resolve => setImmediate(resolve));
  await f.call('saveTrackerApp', { provider: 'trakt', clientId: 'app-id' });
  pending.resolve(reply(tokens('-rotated')));
  await read;
  assert.equal(f.local.trackerAccountsV1.trakt.refreshToken, 'refresh-secret-rotated');
  assert.equal(f.local.trackerAccountsV1.trakt.accountRevision, 'original', 'refresh and sync leave the public account identity stable');
});

test('account revisions change only when the account or application changes', async () => {
  const f = load();
  const saved = (await f.call('saveTrackerApp', { provider: 'trakt', clientId: 'app-id' }))[0];
  assert.match(saved.accountRevision, /^[a-f0-9]{64}$/);
  const connected = (await f.call('connectTracker', { provider: 'trakt' }))[0];
  assert.notEqual(connected.accountRevision, saved.accountRevision);
  const unchanged = (await f.call('saveTrackerApp', { provider: 'trakt', clientId: 'app-id' }))[0];
  assert.equal(unchanged.accountRevision, connected.accountRevision);
  const disconnected = (await f.call('disconnectTracker', { provider: 'trakt' }))[0];
  assert.notEqual(disconnected.accountRevision, connected.accountRevision);
});

test('a stale connect action cannot strand a connected account rotating its refresh token', async () => {
  const pending = gate();
  const f = load({ accounts: { trakt: account({ expiresAt: 1 }) }, fetch: async (url, options) => options.method === 'POST'
    ? pending.promise : reply([], { 'X-Pagination-Page': '1', 'X-Pagination-Page-Count': '0' }) });
  const read = f.call('getTrackerWatchlist', { provider: 'trakt' });
  while (!f.requests.length) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(f.call('connectTracker', { provider: 'trakt' }), /Disconnect the current tracker account/);
  pending.resolve(reply(tokens('-rotated')));
  await read;
  assert.equal(f.flows.length, 0);
  assert.equal(f.local.trackerAccountsV1.trakt.refreshToken, 'refresh-secret-rotated');
});

test('Simkl import exposes at most 500 items in explicit pages and marks truncation', async () => {
  const f = load({ accounts: { simkl: account() }, fetch: async url => url.includes('/activities') ? reply({ all: '2026-10-25T00:00:00Z' })
    : url.includes('/movies/') ? reply({ movies: Array.from({ length: 501 }, (_, i) => ({ status: 'plantowatch', movie: { title: `Film ${i}`, year: 2020 } })) }) : reply({}) });
  const first = await f.call('getTrackerWatchlist', { provider: 'simkl' });
  assert.equal(first.items.length, 100); assert.equal(first.truncated, true);
  const final = await f.call('getTrackerWatchlist', { provider: 'simkl', page: 5, snapshotId: first.snapshotId });
  assert.equal(final.items.length, 100); assert.equal(final.nextPage, null);
  assert.equal(final.skipped, 0); assert.equal(final.truncated, true);
  assert.equal(f.requests.length, 4, 'additional pages read the same immutable snapshot');
});

test('real worker dispatch protects tracker metadata and actions from content-script senders', async () => {
  const { loadWorker } = require('./helpers/worker');
  const f = loadWorker({ local: { trackerAccountsV1: { trakt: account() } } }); await f.ready;
  f.context.chrome.identity = { getRedirectURL: path => `https://fixture.chromiumapp.org/${path}` };
  for (const action of ['getTrackerAccounts', 'saveTrackerApp', 'connectTracker', 'disconnectTracker', 'getTrackerWatchlist']) {
    let response;
    await f.api.handleMessage({ action, data: { provider: 'trakt', clientId: 'app' } }, { url: 'https://trakt.tv/movies/dune' }, value => { response = value; });
    assert.equal(response.success, false);
    assert.equal(response.data, undefined);
    assert.ok(!JSON.stringify(response).includes('secret'));
  }
  let response;
  await f.api.handleMessage({ action: 'getTrackerAccounts' }, { url: 'chrome-extension://test/src/options/options.html' }, value => { response = value; });
  assert.equal(response.success, true);
  assert.equal(response.data[0].connected, true);
  assert.ok(!JSON.stringify(response).includes('secret'));
});

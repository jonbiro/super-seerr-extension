const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const http = require('node:http');
const Config = require('../src/shared/RatingsConfig');
const Model = require('../src/shared/RatingsModel');

for (const destination of ['/api/v1/movie/550/ratingscombined', '/other/api/v1/movie/550/ratingscombined']) {
  test(`session rating requests cannot follow a redirect to ${destination}`, async t => {
    const seen = [];
    const server = http.createServer((request, response) => {
      seen.push(request.url);
      if (request.url.startsWith('/family/')) {
        response.writeHead(302, { Location: destination }); response.end();
      } else {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ imdbRating: 9.9 }));
      }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const context = vm.createContext({ URL, fetch, AbortSignal, window: { location: { origin } } });
    vm.runInContext(fs.readFileSync('src/content/SeerrSession.js', 'utf8'), context);
    const session = context.window.createSeerrSession({ Config, Model, log() {}, getServer: () => new URL(`${origin}/family`) });
    await assert.rejects(session.fetchJsonFromSeerr('/api/v1/movie/550/ratingscombined'));
    assert.deepEqual(seen, ['/family/api/v1/movie/550/ratingscombined'], 'the other installation must never be contacted');
  });
}

test('a direct session response still uses the configured base path and authenticates normally', async () => {
  let captured;
  const context = vm.createContext({ URL, AbortSignal, fetch: async (url, options) => {
    captured = { url, options }; return { ok: true, status: 200, json: async () => ({ imdbRating: 8 }) };
  }, window: { location: { origin: 'https://seerr.example' } } });
  vm.runInContext(fs.readFileSync('src/content/SeerrSession.js', 'utf8'), context);
  const session = context.window.createSeerrSession({ Config, Model, log() {}, getServer: () => new URL('https://seerr.example/family/') });
  assert.equal((await session.fetchJsonFromSeerr('/api/v1/movie/550/ratingscombined')).data.imdbRating, 8);
  assert.equal(captured.url, 'https://seerr.example/family/api/v1/movie/550/ratingscombined');
  assert.equal(captured.options.credentials, 'include');
});

test('a successful session response cancels an oversized body before parsing it', async () => {
  let reads = 0;
  let cancelled = false;
  const body = {
    getReader() {
      return {
        async read() {
          reads++;
          return { done: false, value: new Uint8Array(Config.seerrMaxResponseBytes + 1) };
        },
        async cancel() { cancelled = true; },
        releaseLock() {}
      };
    }
  };
  const origin = 'https://seerr.example';
  const context = vm.createContext({ URL, AbortSignal, fetch: async () => ({
    ok: true, status: 200, headers: { get: () => null }, body
  }), window: { location: { origin } } });
  vm.runInContext(fs.readFileSync('src/content/SeerrSession.js', 'utf8'), context);
  const session = context.window.createSeerrSession({ Config, Model, log() {}, getServer: () => new URL(`${origin}/family`) });
  await assert.rejects(() => session.fetchJsonFromSeerr('/api/v1/movie/550/ratingscombined'), /too large/);
  assert.equal(reads, 1, 'the reader must stop at the first oversized chunk');
  assert.equal(cancelled, true, 'an oversized successful body must be cancelled');
});

for (const status of [404, 503]) for (const cancellationFails of [false, true]) {
  test(`session HTTP ${status} releases its unread body even when cancellation ${cancellationFails ? 'rejects' : 'succeeds'}`, async () => {
    let open = 0, cancelled = 0;
    const responses = [];
    const context = vm.createContext({ URL, AbortSignal, fetch: async () => {
      open++;
      const response = new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('Error response still downloading')); },
        cancel() { open--; cancelled++; if (cancellationFails) throw new Error('Cancellation failed'); }
      }), { status });
      responses.push(response);
      return response;
    }, window: { location: { origin: 'https://seerr.example' } } });
    vm.runInContext(fs.readFileSync('src/content/SeerrSession.js', 'utf8'), context);
    const session = context.window.createSeerrSession({ Config, Model, log() {}, getServer: () => new URL('https://seerr.example/family') });
    try {
      const results = await Promise.all(Array.from({ length: 12 }, (_, id) => session.fetchJsonFromSeerr(`/api/v1/movie/${id + 1}/ratingscombined`)));
      assert.ok(results.every(result => result.ok === false && result.status === status && result.data === null));
      assert.equal(open, 0, 'completed lookups must not leave refused response bodies downloading');
      assert.equal(cancelled, 12);
    } finally { await Promise.allSettled(responses.map(response => response.body.cancel())); }
  });
}

for (const mediaType of ['movie', 'tv']) for (const status of [404, 503]) {
  test(`releasing ${mediaType} HTTP ${status} bodies preserves cache absence/failure semantics`, async () => {
    let opened = 0, cancelled = 0;
    const responses = [];
    const context = vm.createContext({ URL, AbortSignal, fetch: async () => {
      opened++;
      const response = new Response(new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array([1])); },
        cancel() { cancelled++; }
      }), { status });
      responses.push(response);
      return response;
    }, window: { location: { origin: 'https://seerr.example' } } });
    vm.runInContext(fs.readFileSync('src/content/SeerrSession.js', 'utf8'), context);
    const session = context.window.createSeerrSession({ Config, Model, log() {}, getServer: () => new URL('https://seerr.example/family'),
      mergeBundles: (a, b) => a || b, isBundleComplete: () => false });
    const outcome = {};
    try {
      assert.equal(await session.fetchSeerrSessionRatings(550, mediaType, null, outcome), null);
      assert.equal(outcome.conclusive === false, status !== 404, 'only an actual absence can be negatively cached');
      assert.equal(opened, status === 404 || mediaType === 'tv' ? 2 : 3);
      assert.equal(cancelled, opened, 'every failed endpoint must release its body');
    } finally { await Promise.allSettled(responses.map(response => response.body.cancel())); }
  });
}

test('a failed session read closes an actual streaming HTTP response', { timeout: 3000 }, async t => {
  let closed;
  const responseClosed = new Promise(resolve => { closed = resolve; });
  const seen = [];
  const server = http.createServer((request, response) => {
    seen.push(request.url);
    response.once('close', closed);
    response.writeHead(503, { 'Content-Type': 'text/html' });
    response.write('Proxy error body still downloading');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const context = vm.createContext({ URL, fetch, AbortSignal, window: { location: { origin } } });
  vm.runInContext(fs.readFileSync('src/content/SeerrSession.js', 'utf8'), context);
  const session = context.window.createSeerrSession({ Config, Model, log() {}, getServer: () => new URL(`${origin}/family`) });
  assert.equal((await session.fetchJsonFromSeerr('/api/v1/movie/550/ratingscombined')).status, 503);
  await responseClosed;
  assert.deepEqual(seen, ['/family/api/v1/movie/550/ratingscombined']);
});

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

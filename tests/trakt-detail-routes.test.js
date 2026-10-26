const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadIntegration } = require('./helpers/integration');
for (const path of ['/shows/breaking-bad/seasons/1/episodes/1', '/movies/fight-club/comments', '/shows/breaking-bad/comments', '/users/example/lists/movies/example']) {
  test(`Trakt rejects non-title route ${path}`, async t => {
    const f = loadIntegration({site:'trakt', url:`https://trakt.tv${path}`, html:'<h1>Pilot</h1><a href="https://www.themoviedb.org/tv/1396">Series</a>'});
    t.after(() => f.dom.window.close());
    assert.equal(await f.integration().extractMediaData(), null);
  });
}
for (const path of ['/movies/fight-club', '/movie/fight-club/', '/shows/breaking-bad', '/show/breaking-bad/', '/shows/breaking-bad/seasons/1']) {
  test(`Trakt retains detail route ${path}`, async t => {
    const f = loadIntegration({site:'trakt', url:`https://app.trakt.tv${path}`, html:'<h1>Example</h1>'});
    t.after(() => f.dom.window.close());
    assert.equal((await f.integration().extractMediaData()).title, 'Example');
  });
}

test('the manifest injects Trakt on singular detail routes supported by the adapter', () => {
  const manifest = require('../manifest.base.json');
  const entry = manifest.content_scripts.find(script => script.js.includes('src/content/trakt-integration.js'));
  assert.ok(entry, 'Trakt content script entry should exist');
  for (const pattern of [
    'https://trakt.tv/movie/*', 'https://www.trakt.tv/movie/*', 'https://app.trakt.tv/movie/*',
    'https://trakt.tv/show/*', 'https://www.trakt.tv/show/*', 'https://app.trakt.tv/show/*'
  ]) assert.ok(entry.matches.includes(pattern), `missing manifest match ${pattern}`);
});

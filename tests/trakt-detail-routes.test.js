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

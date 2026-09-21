const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadIntegration } = require('./helpers/integration');
for (const path of ['/movie/550-fight-club/cast', '/movie/550/reviews', '/tv/1396/season/1/episode/1', '/movie/550junk', '/movie/0', '/movie/999999999999999999']) {
  test(`TMDB does not turn ${path} into a requestable title`, async t => {
    const f = loadIntegration({site:'tmdb', url:`https://www.themoviedb.org${path}`, html:'<h1>Cast</h1>'});
    t.after(() => f.dom.window.close());
    assert.equal(await f.integration().extractMediaData(), null);
  });
}
for (const path of ['/movie/550', '/movie/550-fight-club/', '/tv/1396-breaking-bad?language=es-ES']) {
  test(`TMDB retains supported detail route ${path}`, async t => {
    const f = loadIntegration({site:'tmdb', url:`https://www.themoviedb.org${path}`, html:'<h1>Example</h1>'});
    t.after(() => f.dom.window.close());
    assert.ok((await f.integration().extractMediaData()).tmdbId > 0);
  });
}

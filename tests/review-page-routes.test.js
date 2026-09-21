const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadIntegration } = require('./helpers/integration');
const cases = [
  ['rt', 'https://www.rottentomatoes.com/m/fight_club/reviews'],
  ['rt', 'https://www.rottentomatoes.com/tv/breaking_bad/s01/e01'],
  ['metacritic', 'https://www.metacritic.com/movie/fight-club/user-reviews/'],
  ['metacritic', 'https://www.metacritic.com/tv/breaking-bad/critic-reviews/']
];
for (const [site, url] of cases) {
  test(`${site} does not request a title from ${new URL(url).pathname}`, async t => {
    const f = loadIntegration({site, url, html:'<h1>User Reviews</h1>'});
    t.after(() => f.dom.window.close());
    assert.equal(await f.integration().extractMediaData(), null);
  });
}
for (const [site, url] of [
  ['rt', 'https://www.rottentomatoes.com/m/fight_club/'],
  ['rt', 'https://www.rottentomatoes.com/tv/breaking_bad/s01'],
  ['metacritic', 'https://www.metacritic.com/movie/fight-club/'],
  ['metacritic', 'https://www.metacritic.com/tv/breaking-bad/season-1/']
]) {
  test(`${site} retains title route ${new URL(url).pathname}`, async t => {
    const f = loadIntegration({site, url, html:'<h1>Example</h1>'});
    t.after(() => f.dom.window.close());
    assert.equal((await f.integration().extractMediaData()).title, 'Example');
  });
}

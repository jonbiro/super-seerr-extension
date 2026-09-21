const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadIntegration } = require('./helpers/integration');

const sites = [
  ['imdb', 'https://www.imdb.com/title/tt8579674/', 'data-testid="hero-title-block__title"'],
  ['letterboxd', 'https://letterboxd.com/film/example/', 'class="headline-1 prettify"'],
  ['metacritic', 'https://www.metacritic.com/movie/example/', 'data-testid="product-title"'],
  ['trakt', 'https://trakt.tv/movies/example', 'data-test-id="movie-title"']
];
for (const [site, url, attributes] of sites) {
  for (const [heading, expected] of [['1917', '1917'], ['Blade Runner 2049', 'Blade Runner 2049'], ['Blade Runner 2049 (2017)', 'Blade Runner 2049']]) {
    test(`${site} preserves title identity in ${heading}`, async t => {
      const f = loadIntegration({ site, url, html: `<h1 ${attributes}>${heading}</h1>` });
      t.after(() => f.dom.window.close());
      assert.equal((await f.integration().extractMediaData())?.title, expected);
    });
  }
}

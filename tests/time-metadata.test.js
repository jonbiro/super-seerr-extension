const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadIntegration } = require('./helpers/integration');

for (const [site, url] of [
  ['trakt', 'https://trakt.tv/movies/fight-club'],
  ['metacritic', 'https://www.metacritic.com/movie/fight-club/'],
  ['letterboxd', 'https://letterboxd.com/film/fight-club/'],
  ['rt', 'https://www.rottentomatoes.com/m/fight_club'],
  ['tmdb', 'https://www.themoviedb.org/movie/550-fight-club']
]) {
  test(`${site} reads release year from machine-readable time metadata`, async t => {
    const f = loadIntegration({ site, url, html: '<h1>Fight Club</h1><time datetime="1999-10-15">October 15</time>' });
    t.after(() => f.dom.window.close());
    assert.equal((await f.integration().extractMediaData()).year, 1999);
  });
}

for (const [date, label, expected] of [
  ['1999-10-15', 'Released in 2000', 2000],
  ['PT1999S', 'Runtime', null],
  ['9999-10-15', 'October 15', null],
  ['not-a-date', 'Released in 1999', 1999]
]) {
  test(`time metadata handles ${date} and ${label}`, async t => {
    const f = loadIntegration({ site: 'trakt', url: 'https://trakt.tv/movies/example',
      html: `<h1>Example</h1><time datetime="${date}">${label}</time>` });
    t.after(() => f.dom.window.close());
    assert.equal((await f.integration().extractMediaData()).year, expected);
  });
}

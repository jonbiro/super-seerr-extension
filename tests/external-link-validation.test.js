const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadIntegration } = require('./helpers/integration');
for (const [label, bad] of [
  ['lookalike', 'https://not-imdb.com/title/tt999/'],
  ['embedded URL', 'https://example.com/?url=https://www.imdb.com/title/tt999/'],
  ['partial ID', 'https://www.imdb.com/title/tt999junk/']
]) {
  test(`shared IMDb extraction skips ${label}`, async t => {
    const f = loadIntegration({site: 'rt', url:'https://www.rottentomatoes.com/m/fight_club', html:`<h1>Fight Club</h1><a href="${bad}">Decoy</a><a href="https://www.imdb.com/title/tt0137523/?ref_=test">IMDb</a>`});
    t.after(() => f.dom.window.close());
    assert.equal((await f.integration().extractMediaData()).imdbId, 'tt0137523');
  });
}
for (const [label, bad] of [
  ['lookalike', 'https://not-themoviedb.org/movie/999'],
  ['embedded URL', 'https://example.com/?url=https://www.themoviedb.org/movie/999'],
  ['partial ID', 'https://www.themoviedb.org/movie/999junk']
]) {
  test(`Letterboxd TMDB extraction skips ${label}`, async t => {
    const f = loadIntegration({site:'letterboxd', url:'https://letterboxd.com/film/fight-club/', html:`<h1>Fight Club</h1><a href="${bad}">Decoy</a><a href="https://www.themoviedb.org/movie/550-fight-club">TMDB</a>`});
    t.after(() => f.dom.window.close());
    assert.equal((await f.integration().extractMediaData()).tmdbId, 550);
  });
}

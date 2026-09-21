const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadIntegration } = require('./helpers/integration');
for (const [label, html, expected] of [
  ['opposite media type', '<a href="https://www.themoviedb.org/movie/550">Movie</a><a href="https://www.themoviedb.org/tv/1396">Series</a>', 1396],
  ['lookalike host', '<a href="https://not-themoviedb.org/tv/999">Decoy</a><a href="https://www.themoviedb.org/tv/1396">Series</a>', 1396],
  ['embedded URL', '<a href="https://example.com/?next=https://www.themoviedb.org/tv/999">Decoy</a><a href="https://www.themoviedb.org/tv/1396">Series</a>', 1396],
  ['malformed data ID', '<div data-tmdb-id="999junk"></div><div data-tmdb-id="1396"></div>', 1396],
  ['no matching type', '<a href="https://www.themoviedb.org/movie/550">Movie</a>', null],
  ['valid slug', '<a href="https://www.themoviedb.org/tv/1396-breaking-bad">Series</a>', 1396]
]) {
  test(`Trakt ignores ${label} when extracting TV identity`, async t => {
    const f = loadIntegration({ site: 'trakt', url: 'https://trakt.tv/shows/breaking-bad', html: `<h1>Breaking Bad</h1>${html}` });
    t.after(() => f.dom.window.close());
    assert.equal((await f.integration().extractMediaData()).tmdbId, expected);
  });
}

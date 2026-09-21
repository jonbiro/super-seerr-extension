// The seven site integrations had no direct coverage, yet they are the most
// fragile code here: they depend on third-party markup and on the shared
// extractor. These pin the extraction contract each one is expected to meet.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadIntegration } = require('./helpers/integration');

// createMediaData stamps the site name lowercased, spaces and all.
const SOURCE_LABELS = {
  imdb: 'imdb', tmdb: 'tmdb', letterboxd: 'letterboxd', rt: 'rotten tomatoes',
  metacritic: 'metacritic', trakt: 'trakt', filmweb: 'filmweb'
};

const { SITES } = require('./browser/site-fixtures.cjs');

for (const { site, url, html, expect } of SITES) {
  test(`${site} extracts ${expect.mediaType} "${expect.title}" from ${new URL(url).pathname}`, async t => {
    // A decoy page title: extractTitle falls back to document.title, so a
    // matching one would let a broken selector pass unnoticed.
    const fixture = loadIntegration({ site, url, html, title: `Decoy Fallback Title - ${site}` });
    t.after(() => fixture.dom.window.close());

    const data = await fixture.integration().extractMediaData();
    assert.ok(data, 'extraction should produce media data');
    for (const [field, value] of Object.entries(expect)) {
      assert.equal(data[field], value, `${site}: ${field}`);
    }
    assert.equal(data.source, SOURCE_LABELS[site], 'source label');
  });
}

test('every integration returns null rather than guessing on an unrelated page', async t => {
  const offRoute = {
    imdb: 'https://www.imdb.com/chart/top/',
    tmdb: 'https://www.themoviedb.org/person/287',
    letterboxd: 'https://letterboxd.com/films/popular/',
    rt: 'https://www.rottentomatoes.com/browse/movies_at_home/',
    metacritic: 'https://www.metacritic.com/browse/movie/',
    trakt: 'https://trakt.tv/users/someone',
    filmweb: 'https://www.filmweb.pl/ranking/film'
  };
  for (const [site, url] of Object.entries(offRoute)) {
    const fixture = loadIntegration({ site, url, html: '<h1>Something Else</h1>' });
    t.after(() => fixture.dom.window.close());
    const data = await fixture.integration().extractMediaData();
    assert.equal(data, null, `${site} should not extract from ${new URL(url).pathname}`);
  }
});

for (const title of ['403 Forbidden', 'Just a moment...', 'Access Denied']) {
  test(`IMDb rejects a non-media page titled ${title}`, async t => {
    const page = loadIntegration({ site: 'imdb', title, html: `<h1>${title}</h1>` });
    t.after(() => page.window.close());
    assert.equal(await page.integration().extractMediaData(), null);
  });
}

test('Trakt generic application title cannot become the movie identity', async t => {
  const page = loadIntegration({ site: 'trakt', url: 'https://app.trakt.tv/movies/fight-club-1999', title: 'Trakt Web: Track Your Shows & Movies', html: '<main></main>' });
  t.after(() => page.window.close());
  const media = await page.integration().extractMediaData();
  assert.equal(media.title, 'Fight Club');
});

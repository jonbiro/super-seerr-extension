// The site integrations had no direct coverage, yet they are the most
// fragile code here: they depend on third-party markup and on the shared
// extractor. These pin the extraction contract each one is expected to meet.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadIntegration } = require('./helpers/integration');

// createMediaData stamps the site name lowercased, spaces and all.
const SOURCE_LABELS = {
  imdb: 'imdb', tmdb: 'tmdb', letterboxd: 'letterboxd', rt: 'rotten tomatoes',
  metacritic: 'metacritic', trakt: 'trakt', filmweb: 'filmweb', simkl: 'simkl', justwatch: 'justwatch'
};

const { SITES } = require('./browser/site-fixtures.cjs');

for (const { site, url, html, expect, pageTitle } of SITES) {
  test(`${site} extracts ${expect.mediaType} "${expect.title}" from ${new URL(url).pathname}`, async t => {
    // A decoy page title: extractTitle falls back to document.title, so a
    // matching one would let a broken selector pass unnoticed.
    const fixture = loadIntegration({ site, url, html, title: pageTitle || `Decoy Fallback Title - ${site}` });
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

for (const title of ['403 Forbidden', '403 - Forbidden', 'Error 403: Forbidden', 'Just a moment...', 'Access Denied']) {
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

test('Trakt numeric media IDs do not become false titles on generic pages', async t => {
  const page = loadIntegration({ site: 'trakt', url: 'https://app.trakt.tv/movies/550', title: 'Trakt Web: Track Your Shows & Movies', html: '<main></main>' });
  t.after(() => page.window.close());
  assert.equal(await page.integration().extractMediaData(), null);
});

const blockedFixtures = {
  imdb: 'https://www.imdb.com/title/tt0137523/',
  tmdb: 'https://www.themoviedb.org/movie/550-fight-club',
  rt: 'https://www.rottentomatoes.com/m/fight_club',
  metacritic: 'https://www.metacritic.com/movie/fight-club',
  filmweb: 'https://www.filmweb.pl/film/Fight+Club-1999-837',
  letterboxd: 'https://letterboxd.com/film/fight-club/',
  simkl: 'https://simkl.com/movies/53894/fight-club',
  justwatch: 'https://www.justwatch.com/us/movie/fight-club'
};
for (const [site, url] of Object.entries(blockedFixtures)) {
  test(`${site} ignores a provider challenge page on a title route`, async t => {
    const page = loadIntegration({ site, url, title: '403 Forbidden', html: '<h1>Sorry, you have been blocked</h1>' });
    t.after(() => page.window.close());
    assert.equal(await page.integration().extractMediaData(), null);
  });
}

for (const title of ['403 - Forbidden', 'Error 403: Forbidden']) {
  test(`Trakt rejects a provider challenge titled ${title}`, async t => {
    const page = loadIntegration({ site: 'trakt', url: 'https://trakt.tv/movies/fight-club-1999', title, html: `<h1>${title}</h1>` });
    t.after(() => page.dom.window.close());
    assert.equal(await page.integration().extractMediaData(), null);
  });
}

for (const title of ['Attention Required! | Cloudflare', 'Just a moment...']) {
  test(`Trakt rejects an edge challenge titled ${title}`, async t => {
    const page = loadIntegration({ site: 'trakt', url: 'https://trakt.tv/movies/fight-club-1999', title,
      html: '<h1>Sorry, you have been blocked</h1>' });
    t.after(() => page.window.close());
    assert.equal(await page.integration().extractMediaData(), null);
  });
}

test('Trakt rejects a blocked heading even when the document title is generic', async t => {
  const page = loadIntegration({ site: 'trakt', url: 'https://trakt.tv/movies/fight-club-1999', title: 'Trakt',
    html: '<h1>Sorry, you have been blocked</h1>' });
  t.after(() => page.window.close());
  assert.equal(await page.integration().extractMediaData(), null);
});

const errorPageRoutes = [...new Map(SITES.map(({ site, url }) => [site, url])).entries()];
for (const [site, url] of errorPageRoutes) {
  test(`${site} ignores a generic 404 document on a title route`, async t => {
    const page = loadIntegration({
      site,
      url,
      title: `404 Not Found - ${site}`,
      html: '<main><h1>404 Not Found</h1></main>'
    });
    t.after(() => page.dom.window.close());
    assert.equal(await page.integration().extractMediaData(), null);
  });
}

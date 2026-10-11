const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadIntegration } = require('./helpers/integration');

for (const [slug, title, year] of [
  ['am%C3%A9lie-2001', 'Amélie', 2001], ['%C3%A9lan-2020', 'Élan', 2020],
  ['the-thing-1982', 'The Thing', 1982], ['1917-2019', '1917', 2019],
  ['blade-runner-2049-2017', 'Blade Runner 2049', 2017],
  ['space-1000', 'Space 1000', null], ['space-9999', 'Space 9999', null]
]) for (const suffix of ['', '/']) {
  test(`Trakt fallback retains title and year from ${slug}${suffix}`, async t => {
    const f = loadIntegration({ site: 'trakt', url: `https://app.trakt.tv/movies/${slug}${suffix}`,
      title: 'Trakt Web: Track Your Shows & Movies', html: '<main></main>' });
    t.after(() => f.window.close());
    const media = await f.integration().extractMediaData();
    assert.equal(media.title, title);
    assert.equal(media.year, year);
  });
}

test('Trakt does not invent an identity from an undecodable fallback slug', async t => {
  const f = loadIntegration({ site: 'trakt', url: 'https://app.trakt.tv/movies/%E0%A4%A-2001',
    title: 'Trakt Web: Track Your Shows & Movies', html: '<main></main>' });
  t.after(() => f.window.close());
  assert.equal(await f.integration().extractMediaData(), null);
});

test('Trakt release metadata remains authoritative over a fallback slug year', async t => {
  const f = loadIntegration({ site: 'trakt', url: 'https://app.trakt.tv/movies/the-thing-1982',
    title: 'Trakt Web: Track Your Shows & Movies', html: '<span data-test-id="movie-year">1983</span>' });
  t.after(() => f.window.close());
  assert.equal((await f.integration().extractMediaData()).year, 1983);
});

for (const [slug, title, year] of [
  ['am%C3%A9lie-2001', 'Amélie', 2001],
  ['blade-runner-2049-2017', 'Blade Runner 2049', 2017]
]) {
  test(`Trakt visible title ${title} retains its matching slug year`, async t => {
    const f = loadIntegration({ site: 'trakt', url: `https://app.trakt.tv/movies/${slug}`,
      title: `Trakt Web: ${title}`, html: `<h1>${title}</h1>` });
    t.after(() => f.window.close());
    const media = await f.integration().extractMediaData();
    assert.equal(media.title, title);
    assert.equal(media.year, year);
  });
}

test('Trakt visible titles retain literal year-like suffixes without inventing a release year', async t => {
  const f = loadIntegration({ site: 'trakt', url: 'https://trakt.tv/shows/space-1999',
    title: 'Trakt', html: '<h1 data-test-id="show-title">Space: 1999</h1>' });
  t.after(() => f.window.close());
  const media = await f.integration().extractMediaData();
  assert.equal(media.title, 'Space: 1999');
  assert.equal(media.year, null);
});

test('Trakt season query changes preserve the current show flyout and actions', async t => {
  const f = loadIntegration({ site: 'trakt', url: 'https://app.trakt.tv/shows/breaking-bad' });
  t.after(() => f.window.close());
  const integration = f.integration();
  integration.mediaData = { title: 'Breaking Bad', mediaType: 'tv' };
  let navigations = 0;
  integration.handleNavigationChange = () => { navigations++; };
  integration.currentUrl = integration.getNavigationKey();
  const action = integration.captureActionView();

  f.window.history.pushState({}, '', '/shows/breaking-bad?season=1');
  integration.pollForNavigation();
  f.window.history.pushState({}, '', '/shows/breaking-bad/?season=2');
  integration.pollForNavigation();

  assert.equal(integration.getNavigationKey(), 'https://app.trakt.tv/shows/breaking-bad');
  assert.equal(navigations, 0, 'season selection is not a different media page');
  assert.equal(action.isCurrent(), true, 'season selection does not stale an action for this show');

  f.window.history.pushState({}, '', '/shows/better-call-saul');
  integration.pollForNavigation();
  assert.equal(navigations, 1, 'a different show path still retires the old panel');
  assert.equal(action.isCurrent(), false);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadIntegration } = require('./helpers/integration');

for (const [path, mediaType] of [
  ['us/movie/1917', 'movie'], ['us/tv-show/space-1999', 'tv'], ['de/Serie/Space-1999', 'tv'],
  ['uk/tv-series/space-1999', 'tv'], ['jp/映画/1917', 'movie'], ['kr/TV-프로그램/space-1999', 'tv'],
  ['fi/elokuva/1917', 'movie'], ['it/serie-tv/space-1999', 'tv']
]) test(`JustWatch identifies localized ${path} without stripping title numbers`, async t => {
  const title = mediaType === 'movie' ? '1917' : 'Space: 1999';
  const page = loadIntegration({ site: 'justwatch', url: `https://www.justwatch.com/${path}`, html:
    `<h1 class="title-detail-hero__details__title">${title}<span class="release-year"> (2019)</span></h1>
     <aside><a href="https://www.themoviedb.org/movie/999">Another title</a></aside>` });
  t.after(() => page.window.close());
  const media = await page.integration().extractMediaData();
  assert.equal(media.title, title); assert.equal(media.year, 2019); assert.equal(media.mediaType, mediaType);
  assert.equal(media.tmdbId, null);
});

for (const path of ['us/search', 'us/provider/netflix', 'us/tv-show/example/season-1', 'us/movie/example/extra', 'us/unknown/example']) {
  test(`JustWatch ignores non-title route ${path}`, async t => {
    const page = loadIntegration({ site: 'justwatch', url: `https://www.justwatch.com/${path}`,
      html: '<h1 class="title-detail-hero__details__title">Recommendation</h1>' });
    t.after(() => page.window.close());
    assert.equal(await page.integration().extractMediaData(), null);
  });
}

for (const canonical of ['https://www.justwatch.com/us/movie/old-title', 'https://www.justwatch.com.evil.test/us/movie/new-title', 'javascript:alert(1)']) {
  test(`JustWatch rejects mismatched or unsafe canonical ${canonical}`, async t => {
    const page = loadIntegration({ site: 'justwatch', url: 'https://www.justwatch.com/us/movie/new-title',
      html: `<link rel="canonical" href="${canonical}"><h1 class="title-detail-hero__details__title">Old title</h1>` });
    t.after(() => page.window.close());
    assert.equal(await page.integration().extractMediaData(), null);
  });
}

test('JustWatch country site keeps query-only navigation on the same title', async t => {
  const page = loadIntegration({ site: 'justwatch', url: 'https://br.justwatch.com/br/filme/clube-da-luta?source=search',
    html: '<h1 class="title-detail-hero__details__title">Clube da Luta<span class="release-year"> (1999)</span></h1>' });
  t.after(() => page.window.close());
  const adapter = page.integration();
  const key = adapter.getNavigationKey();
  page.window.history.replaceState({}, '', '?source=popular#offers');
  assert.equal(adapter.getNavigationKey(), key);
  assert.equal((await adapter.extractMediaData()).title, 'Clube da Luta');
});

test('JustWatch accepts a localized country subdomain without accepting a lookalike host', async t => {
  const page = loadIntegration({ site: 'justwatch', url: 'https://de.justwatch.com/de/film/fight-club',
    html: '<h1 class="title-detail-hero__details__title">Fight Club<span class="release-year"> (1999)</span></h1>' });
  t.after(() => page.window.close());
  const media = await page.integration().extractMediaData();
  assert.equal(media.title, 'Fight Club');
  assert.equal(media.mediaType, 'movie');

  const lookalike = loadIntegration({ site: 'justwatch', url: 'https://de.justwatch.com.evil.test/de/film/fight-club',
    html: '<h1 class="title-detail-hero__details__title">Fight Club</h1>' });
  t.after(() => lookalike.window.close());
  assert.equal(await lookalike.integration().extractMediaData(), null);
});

test('the manifest injects JustWatch on localized provider hosts', () => {
  const manifest = require('../manifest.base.json');
  const entry = manifest.content_scripts.find(script => script.js.includes('src/content/justwatch-integration.js'));
  assert.ok(entry, 'JustWatch content script entry should exist');
  assert.ok(entry.matches.includes('https://*.justwatch.com/*/*/*'));
  assert.ok(manifest.host_permissions.includes('https://*.justwatch.com/*'));
});

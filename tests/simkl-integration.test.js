const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadIntegration } = require('./helpers/integration');

function fixture(t, { path = '/movies/53894/fight-club', html = '<h1>Fight Club</h1>', schema } = {}) {
  const f = loadIntegration({ site: 'simkl', url: `https://simkl.com${path}`,
    html: html + (schema ? `<script type="application/ld+json">${JSON.stringify(schema)}</script>` : '') });
  t.after(() => f.window.close());
  return f;
}

test('Simkl movie route identifies the visible title without confusing the Simkl ID with TMDB', async t => {
  const media = await fixture(t).integration().extractMediaData();
  assert.equal(media.title, 'Fight Club');
  assert.equal(media.mediaType, 'movie');
  assert.equal(media.tmdbId, null);
  assert.equal(media.source, 'simkl');
});

test('Simkl TV route supports Unicode and numeric titles', async t => {
  for (const title of ['Space: 1999', '三体', '1984']) {
    const media = await fixture(t, { path: '/tv/11121/example', html: `<h1>${title}</h1>` }).integration().extractMediaData();
    assert.equal(media.title, title);
    assert.equal(media.mediaType, 'tv');
    assert.equal(media.year, null);
  }
});

test('Simkl structured graph uses only the current record, with year and exact external identities', async t => {
  const media = await fixture(t, { schema: { '@graph': [
    { '@type': 'Movie', name: 'Decoy', url: 'https://simkl.com/movies/99/decoy', datePublished: '2020-01-01' },
    { '@type': 'Movie', name: 'Fight Club', url: 'https://simkl.com/movies/53894/fight-club', datePublished: '1999-10-15',
      sameAs: ['https://www.themoviedb.org/movie/550', 'https://www.imdb.com/title/tt0137523/'] }
  ] } }).integration().extractMediaData();
  assert.equal(media.title, 'Fight Club');
  assert.equal(media.year, 1999);
  assert.equal(media.tmdbId, 550);
  assert.equal(media.imdbId, 'tt0137523');
});

for (const [type, mediaType] of [['Movie', 'movie'], ['TVSeries', 'tv']]) {
  test(`Simkl anime is ${mediaType} only when structured metadata confirms ${type}`, async t => {
    const media = await fixture(t, { path: '/anime/543146/example', html: '<h1>Example</h1>',
      schema: { '@type': type, name: 'Example', url: 'https://simkl.com/anime/543146/example', datePublished: '2016-08-26' } }).integration().extractMediaData();
    assert.equal(media.mediaType, mediaType);
    assert.equal(media.year, 2016);
  });
}

test('Simkl anime without type metadata remains unresolved', async t => {
  assert.equal(await fixture(t, { path: '/anime/543146/example', html: '<h1>Example</h1>' }).integration().extractMediaData(), null);
});

test('Simkl anime microdata distinguishes a movie from a series', async t => {
  const media = await fixture(t, { path: '/anime/543146/example', html: '<main itemscope itemtype="https://schema.org/Movie"><h1>君の名は。</h1><time itemprop="datePublished" datetime="2016-08-26"></time></main>' }).integration().extractMediaData();
  assert.equal(media.mediaType, 'movie');
  assert.equal(media.year, 2016);
});

for (const path of ['/tv/11121/breaking-bad/episodes/', '/movies/53894/fight-club/memos/', '/movies/', '/12345/lists/', '/anime/543146/example/episode-1']) {
  test(`Simkl rejects non-title route ${path}`, async t => {
    assert.equal(await fixture(t, { path }).integration().extractMediaData(), null);
  });
}

test('Simkl ignores malformed JSON and unrelated recommendation metadata', async t => {
  const media = await fixture(t, { html: '<h1>Fight Club</h1><script type="application/ld+json">broken</script>',
    schema: [{ '@type': 'Movie', name: 'Recommended film', url: 'https://simkl.com/movies/22/other', datePublished: '2025-01-01' }] }).integration().extractMediaData();
  assert.equal(media.title, 'Fight Club');
  assert.equal(media.year, null);
});

test('Simkl refuses ambiguous anime metadata', async t => {
  assert.equal(await fixture(t, { path: '/anime/543146/example', html: '<h1>Example</h1>', schema: [
    { '@type': 'Movie', name: 'Example', url: 'https://simkl.com/anime/543146/example' },
    { '@type': 'TVSeries', name: 'Example', url: 'https://simkl.com/anime/543146/example' }
  ] }).integration().extractMediaData(), null);
});

test('Simkl waits when a SPA still exposes the previous title canonical', async t => {
  assert.equal(await fixture(t, { html: '<link rel="canonical" href="https://simkl.com/movies/99/previous"><h1>Previous</h1>' }).integration().extractMediaData(), null);
});

test('Simkl refuses a route and primary metadata type disagreement', async t => {
  assert.equal(await fixture(t, { schema: { '@type': 'TVSeries', name: 'Fight Club', url: 'https://simkl.com/movies/53894/fight-club' } }).integration().extractMediaData(), null);
});

test('Simkl never borrows a recommendation release year', async t => {
  const media = await fixture(t, { html: '<h1>Fight Club</h1><aside><time itemprop="datePublished" datetime="2025-01-01"></time></aside>' }).integration().extractMediaData();
  assert.equal(media.year, null);
});

test('Simkl rejects spoofed external hosts, wrong type links and conflicting IDs', async t => {
  const media = await fixture(t, { html: `<h1>Fight Club</h1>
    <a href="https://www.themoviedb.org.evil.example/movie/550">Spoof</a>
    <a href="https://www.themoviedb.org/tv/550">Wrong type</a>
    <a href="https://www.themoviedb.org/movie/550">One</a>
    <a href="https://www.themoviedb.org/movie/551">Two</a>
    <a href="https://imdb.com.evil.example/title/tt0137523/">Spoof</a>` }).integration().extractMediaData();
  assert.equal(media.tmdbId, null);
  assert.equal(media.imdbId, null);
});

test('Simkl does not turn a blocked page into a media title', async t => {
  assert.equal(await fixture(t, { html: '<h1>403 Forbidden</h1>' }).integration().extractMediaData(), null);
});

test('Simkl recommendations cannot supply external identity to a visible title', async t => {
  const media = await fixture(t, { html: '<h1>Fight Club</h1><aside><a href="https://www.themoviedb.org/movie/22">Decoy</a><a href="https://www.imdb.com/title/tt0000022/">Decoy</a></aside>' }).integration().extractMediaData();
  assert.equal(media.tmdbId, null);
  assert.equal(media.imdbId, null);
});

test('Simkl bound sameAs identity wins over recommendation anchors', async t => {
  const media = await fixture(t, { html: '<h1>Fight Club</h1><aside><a href="https://www.themoviedb.org/movie/22">Decoy</a></aside>',
    schema: { '@type': 'Movie', name: 'Fight Club', url: 'https://simkl.com/movies/53894/fight-club', sameAs: 'https://www.themoviedb.org/movie/550' } }).integration().extractMediaData();
  assert.equal(media.tmdbId, 550);
});

test('Simkl Cloudflare challenge document title prevents a domain-name flyout', async t => {
  const f = fixture(t, { html: '<h1>simkl.com</h1><p>Verify you are human</p>' });
  f.window.document.title = 'Just a moment...';
  assert.equal(await f.integration().extractMediaData(), null);
});

test('Simkl rejects a domain heading even when a challenge has no document title', async t => {
  assert.equal(await fixture(t, { html: '<h1>www.simkl.com</h1>' }).integration().extractMediaData(), null);
});

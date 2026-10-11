const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadIntegration } = require('./helpers/integration');

for (const label of ['TV Series', 'TV Mini-Series', 'TV Mini–Series', 'TV\u00a0Mini\u00a0Series', 'Miniseries', '12 episodes']) {
  test(`IMDb recognizes scoped hero metadata ${label} without relying on list wrappers`, async t => {
    const f = loadIntegration({ site: 'imdb', html: `<h1 data-testid="hero-title-block__title">Example</h1>
      <div data-testid="hero-title-block__metadata"><a>${label}</a><a>2020–2022</a></div>` });
    t.after(() => f.window.close());
    const media = await f.integration().extractMediaData();
    assert.equal(media.mediaType, 'tv');
    assert.equal(media.year, 2020);
  });
}

for (const query of ['?ref=/episodes/', '#/episodes/', '?redirect=https://example.com/episodes/']) {
  test(`IMDb movie type ignores non-route episode text in ${query}`, async t => {
    const f = loadIntegration({ site: 'imdb', url: `https://www.imdb.com/title/tt0137523/${query}`,
      html: '<h1 data-testid="hero-title-block__title">Fight Club</h1><ul data-testid="hero-title-block__metadata"><li>Movie</li><li>1999</li></ul>' });
    t.after(() => f.window.close());
    assert.equal((await f.integration().extractMediaData()).mediaType, 'movie');
  });
}

test('IMDb ignores episode and series metadata outside the title hero', async t => {
  const f = loadIntegration({ site: 'imdb', html: '<h1 data-testid="hero-title-block__title">Fight Club</h1>'
    + '<ul data-testid="hero-title-block__metadata"><li>Movie</li><li>1999</li></ul>'
    + '<aside><div class="subtext">TV Series • 12 episodes</div></aside>' });
  t.after(() => f.window.close());
  assert.equal((await f.integration().extractMediaData()).mediaType, 'movie');
});

test('IMDb legacy title metadata still recognizes television', async t => {
  const f = loadIntegration({ site: 'imdb', html: '<div class="title_wrapper"><h1>Example</h1><div class="subtext">TV Mini-Series • 2020</div></div>' });
  t.after(() => f.window.close());
  assert.equal((await f.integration().extractMediaData()).mediaType, 'tv');
});

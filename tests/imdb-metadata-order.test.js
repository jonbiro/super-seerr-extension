const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadIntegration } = require('./helpers/integration');
for (const [label, html, expected] of [
  ['type before year', '<a>TV Series</a><a>2008–2013</a><a>TV-MA</a>', 2008],
  ['rating before year', '<a>R</a><a>1999</a>', 1999],
  ['no hero year', '<a>TV Series</a><a>TV-MA</a>', null]
]) {
  test(`IMDb reads scoped hero metadata with ${label}`, async t => {
    const f = loadIntegration({site:'imdb',url:'https://www.imdb.com/title/tt0903747/',html:`<h1 data-testid="hero-title-block__title">Example</h1><ul data-testid="hero-title-block__metadata">${html}</ul><aside><a>2025</a></aside>`});
    t.after(() => f.dom.window.close());
    assert.equal((await f.integration().extractMediaData()).year, expected);
  });
}

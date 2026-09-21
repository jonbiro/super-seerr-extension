const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadIntegration } = require('./helpers/integration');

for (const title of ['1917', 'Blade Runner 2049', 'Season of the Witch', 'The Seasoning House']) {
  test(`RT preserves the actual title ${title}`, async t => {
    const f = loadIntegration({ site: 'rt', url: 'https://www.rottentomatoes.com/m/example',
      html: `<h1 data-qa="score-panel-movie-title">${title}</h1>` });
    t.after(() => f.dom.window.close());
    const media = await f.integration().extractMediaData();
    assert.equal(media?.title, title);
  });
}

for (const title of ['Breaking Bad Season 2', 'Breaking Bad: Season 2', 'Breaking Bad – Season 2']) {
  test(`RT removes the numbered season label in ${title}`, async t => {
    const f = loadIntegration({ site: 'rt', url: 'https://www.rottentomatoes.com/tv/breaking_bad/s02',
      html: `<h1>${title}</h1>` });
    t.after(() => f.dom.window.close());
    assert.equal((await f.integration().extractMediaData()).title, 'Breaking Bad');
  });
}

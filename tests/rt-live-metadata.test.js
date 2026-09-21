const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadIntegration } = require('./helpers/integration');
for (const [label, metadata, expected] of [['TV range', '2008 - 2013, ', 2008], ['movie', '1999, ', 1999], ['unknown', '5 Seasons', null]]) {
  test(`RT hero metadata extracts ${label} without borrowing related-title dates`, async t => {
    const f = loadIntegration({ site: 'rt', url: 'https://www.rottentomatoes.com/tv/breaking_bad',
      html: `<h1>Breaking Bad</h1><media-hero><rt-text slot="metadata-prop">TV-14, </rt-text><rt-text slot="metadata-prop">${metadata}</rt-text></media-hero><aside><rt-text slot="metadata-prop">2026</rt-text></aside>` });
    t.after(() => f.dom.window.close());
    const media = await f.integration().extractMediaData();
    assert.equal(media.year, expected);
  });
}

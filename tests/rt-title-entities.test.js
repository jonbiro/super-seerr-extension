const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker } = require('./helpers/worker');
const row = title => `<search-page-media-row release-year="2020" tomatometer-score="80"><a data-qa="info-name" href="/m/example">${title}</a></search-page-media-row>`;
const detail = '<script id="media-scorecard-json">{"audienceScore":{"score":90}}</script>';

for (const [title, encoded] of [
  ['Fight Club', '&#x46;ight Club'],
  ['𠮷野', '&#134071;野'],
  ['𠮷野', '&#X20BB7;野']
]) test(`encoded RT title ${encoded} matches and shares its complete Unicode identity`, async () => {
  const worker = loadWorker(); await worker.ready;
  worker.api.fetchRtHtml = async url => url.includes('/search?') ? row(encoded) : detail;
  const result = await worker.api.getRottenTomatoesRatings({ title, year: 2020, mediaType: 'movie', tmdbId: 550 });
  assert.equal(result?.matchedTitle, title);
  assert.equal(result.confidence, 1);
  assert.equal(worker.api.publicRatings.get('movie:550').value.matchedTitle, title);
  await worker.api.flushRtCache();
});

for (const encoded of ['&amp;#70;ight Club', '&#38;#70;ight Club']) test(`escaped RT reference ${encoded} cannot become a false exact shared match`, async () => {
  const worker = loadWorker(); await worker.ready;
  worker.api.fetchRtHtml = async url => url.includes('/search?') ? row(encoded) : detail;
  const result = await worker.api.getRottenTomatoesRatings({ title: 'Fight Club', year: 2020, mediaType: 'movie', tmdbId: 550 });
  assert.equal(result, null);
  assert.equal(worker.api.publicRatings.size, 0);
  await worker.api.flushRtCache();
});

test('entity decoding is single-pass and rejects invalid Unicode scalar values', () => {
  const { api } = loadWorker();
  assert.equal(api.decodeHtml('&amp;lt; &#38;quot; &quot; &apos; &lt; &gt;'), '&lt; &quot; " \' < >');
  for (const encoded of ['&#0;', '&#xD800;', '&#xDFFF;', '&#1114112;', '&#999999999999999999999999;']) {
    assert.equal(api.decodeHtml(encoded), '\uFFFD', encoded);
  }
});

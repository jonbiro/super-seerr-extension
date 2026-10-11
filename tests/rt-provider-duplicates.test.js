const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker } = require('./helpers/worker');

for (const mediaType of ['movie', 'tv']) for (const variant of ['absolute', 'protocol-relative', 'default port']) {
  for (const reversed of [false, true]) test(`equivalent RT ${mediaType} links share one verified score (${variant}, reversed: ${reversed})`, async () => {
    const path = `/${mediaType === 'tv' ? 'tv' : 'm'}/example`;
    const alternate = variant === 'absolute' ? `https://www.rottentomatoes.com${path}`
      : variant === 'protocol-relative' ? `//www.rottentomatoes.com${path}` : `https://www.rottentomatoes.com:443${path}`;
    const links = reversed ? [alternate, path] : [path, alternate];
    const html = links.map(href => `<search-page-media-row release-year="2020" tomatometer-score="80"><a data-qa="info-name" href="${href}">Example</a></search-page-media-row>`).join('');
    const worker = loadWorker(); await worker.ready;
    const calls = [];
    worker.api.fetchRtHtml = async url => {
      calls.push(url);
      return url.includes('/search?') ? html
        : '<script id="media-scorecard-json">{"criticsScore":{"score":80},"audienceScore":{"score":90}}</script>';
    };
    const input = { title: 'Example', year: 2020, mediaType, tmdbId: 123 };
    const result = await worker.api.getRottenTomatoesRatings(input);
    assert.equal(result?.rtCriticsScore, 80);
    assert.equal(result.rtAudienceScore, 90);
    assert.equal(calls.length, 2, 'one search and one detail read serve duplicate links');
    await worker.api.flushRtCache();
    assert.equal(worker.api.publicRatings.size, 1);
    const second = loadWorker({ get: async () => ({ seerrUrl: 'https://second.example' }), local: worker.localStore });
    await second.ready;
    second.api.fetchRtHtml = async () => { throw new Error('Shared score must not need another provider lookup'); };
    assert.equal((await second.api.getRottenTomatoesRatings({ ...input, title: 'Localized title' })).rtCriticsScore, 80);
  });
}

for (const mediaType of ['movie', 'tv']) test(`distinct RT ${mediaType} pages remain ambiguous`, async () => {
  const worker = loadWorker(); await worker.ready;
  const prefix = mediaType === 'tv' ? '/tv/' : '/m/';
  worker.api.fetchRtHtml = async () => ['example', 'another_example'].map(slug =>
    `<search-page-media-row release-year="2020" tomatometer-score="80"><a data-qa="info-name" href="${prefix}${slug}">Example</a></search-page-media-row>`).join('');
  assert.equal(await worker.api.getRottenTomatoesRatings({ title: 'Example', year: 2020, mediaType, tmdbId: 123 }), null);
  assert.equal(worker.api.publicRatings.size, 0);
});

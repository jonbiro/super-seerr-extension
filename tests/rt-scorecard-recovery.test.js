const { test } = require('node:test');
const assert = require('node:assert/strict');
const Config = require('../src/shared/RatingsConfig');
const { loadWorker } = require('./helpers/worker');
const input = { title: 'Fight Club', year: 1999, mediaType: 'movie', tmdbId: 550 };
const key = 'movie:Fight Club:1999';
const search = critics => `<search-page-media-row release-year="1999" tomatometer-score="${critics}"><a data-qa="info-name" href="/m/fight_club">Fight Club</a></search-page-media-row>`;
const scorecard = json => `<script id="media-scorecard-json" type="application/json">${json}</script>`;

const missingScorecards = [
  ['empty page', ''],
  ['consent page', '<html><title>Consent required</title><main>Please accept cookies</main></html>'],
  ['unrelated script', '<script data-id="media-scorecard-json">{"criticsScore":{"score":99}}</script>'],
  ['truncated script', '<script id="media-scorecard-json">{"criticsScore":{"score":99}}']
];
for (const [label, initialDetail] of [
  ...['{"audienceScore":', 'null', '[]', '42', '"unexpected"'].map(json => [json, scorecard(json)]),
  ...missingScorecards
]) {
  test(`unreadable scorecard (${label}) stays inconclusive and recovers on another site`, async () => {
    const worker = loadWorker(); await worker.ready;
    let now = Date.now(); worker.context.Date = class extends Date { static now() { return now; } };
    let detail = initialDetail, calls = 0;
    worker.api.fetchRtHtml = async url => { calls++; return url.includes('/search?') ? search(80) : detail; };
    const failed = await worker.api.getRottenTomatoesRatings(input);
    assert.equal(failed.rtCriticsScore, 80, 'the displayable search score can still be returned');
    assert.equal(failed.diagnostic, 'failed');
    assert.equal(worker.api.publicRatings.size, 0, 'a broken detail read cannot verify a public score');
    await worker.api.flushRtCache();
    const saved = worker.localStore.rtCacheV1.entries[key];
    assert.equal(saved.expiresAt - saved.checkedAt, Config.inconclusiveRetryMs);
    await worker.api.getRottenTomatoesRatings(input);
    assert.equal(calls, 2);
    now += Config.inconclusiveRetryMs + 1;
    detail = scorecard('{"audienceScore":{"score":90}}');
    worker.api.baseUrl = 'https://other-seerr.example';
    const recovered = await worker.api.getRottenTomatoesRatings(input);
    assert.equal(recovered.rtAudienceScore, 90);
    assert.equal(recovered.diagnostic, 'rated');
    assert.equal(calls, 4);
    assert.equal(worker.api.publicRatings.get('movie:550').value.rtAudienceScore, 90);
    await worker.api.flushRtCache();
  });
}

for (const [label, failedDetail] of [['malformed JSON', scorecard('{"audienceScore":')], ...missingScorecards]) test(`a failed detail refresh (${label}) preserves successful title and public scores and their age`, async () => {
  const worker = loadWorker(); await worker.ready;
  let detail = scorecard('{"audienceScore":{"score":90}}'), critics = 80;
  worker.api.fetchRtHtml = async url => url.includes('/search?') ? search(critics) : detail;
  await worker.api.getRottenTomatoesRatings(input);
  const title = worker.api.rtCache.get(key), shared = worker.api.publicRatings.get('movie:550');
  detail = failedDetail; critics = 95;
  const attempt = await worker.api.getRottenTomatoesRatings({ ...input, refresh: true });
  assert.equal(attempt.diagnostic, 'failed');
  assert.equal(worker.api.rtCache.get(key), title);
  assert.equal(worker.api.publicRatings.get('movie:550'), shared);
  const fallback = await worker.api.getRottenTomatoesRatings(input);
  assert.equal(fallback.rtCriticsScore, 80);
  assert.equal(fallback.rtAudienceScore, 90);
  assert.equal(fallback.lastUpdated, shared.checkedAt);
  await worker.api.flushRtCache();
});

for (const attributes of ['id="media-scorecard-json"', "id='media-scorecard-json'", "type='application/json' id = 'media-scorecard-json'"]) {
  test(`scorecard attributes ${attributes} yield complete shared scores`, async () => {
    const worker = loadWorker(); await worker.ready;
    worker.api.fetchRtHtml = async url => url.includes('/search?') ? search(80)
      : `<script ${attributes}>{"criticsScore":{"score":0},"audienceScore":{"score":"90"}}</script>`;
    const result = await worker.api.getRottenTomatoesRatings(input);
    assert.equal(result.rtCriticsScore, 0, 'a real zero is valid and overrides the search score');
    assert.equal(result.rtAudienceScore, 90);
    assert.equal(result.diagnostic, 'rated');
    assert.equal(worker.api.publicRatings.get('movie:550').value.rtCriticsScore, 0);
    await worker.api.flushRtCache();
  });
}

test('a valid unrated scorecard is still a completed read', async () => {
  const worker = loadWorker(); await worker.ready;
  worker.api.fetchRtHtml = async url => url.includes('/search?') ? search('')
    : scorecard('{"criticsScore":{"score":"N/A"},"audienceScore":{"score":null}}');
  const result = await worker.api.getRottenTomatoesRatings(input);
  assert.equal(result.diagnostic, 'rated');
  assert.equal(result.rtCriticsScore, null);
  assert.equal(result.rtAudienceScore, null);
  assert.equal(worker.api.publicRatings.size, 0);
  assert.equal(worker.api.rtCache.get(key).expiresAt - worker.api.rtCache.get(key).checkedAt, Config.rtNegativeCacheTtlMs);
  await worker.api.flushRtCache();
});

test('another script data-id must not impersonate the scorecard ID', async () => {
  const worker = loadWorker(); await worker.ready;
  const scores = worker.api.parseRtScorecard('<script data-id="media-scorecard-json">{"criticsScore":{"score":99}}</script>'
    + '<script id="media-scorecard-json">{"criticsScore":{"score":0}}</script>');
  assert.equal(scores.rtCriticsScore, 0);
});

for (const value of [[90], ['90%'], '0x64', '0b1', '1e2', '9e1%']) test(`malformed percentage ${JSON.stringify(value)} cannot become a shared score`, async () => {
  const worker = loadWorker(); await worker.ready;
  worker.api.fetchRtHtml = async url => url.includes('/search?') ? search('')
    : scorecard(JSON.stringify({ criticsScore: { score: value }, audienceScore: { score: value } }));
  const result = await worker.api.getRottenTomatoesRatings(input);
  assert.equal(result.rtCriticsScore, null);
  assert.equal(result.rtAudienceScore, null);
  assert.equal(worker.api.publicRatings.size, 0);
  await worker.api.flushRtCache();
  assert.deepEqual(Object.keys(worker.localStore.publicRatingsV1.entries), []);
});

test('decimal percentages and numeric scores retain rounding and real zero', () => {
  const { api } = loadWorker();
  for (const [value, expected] of [[0, 0], [100, 100], [90.4, 90], ['0%', 0], [' 90% ', 90], ['90.5%', 91], ['90 %', 90], ['.5', 1]]) {
    assert.equal(api.parseRtPercent(value), expected, JSON.stringify(value));
  }
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker } = require('./helpers/worker');

const first = { title: 'Alpha', originalTitle: 'Beta:2020:original:Gamma', year: 2020, mediaType: 'movie' };
const second = { title: 'Alpha:2020:original:Beta', originalTitle: 'Gamma', year: 2020, mediaType: 'movie' };

function provider(api) {
  const calls = [];
  api.fetchRtHtml = async url => { calls.push(url); return url; };
  api.parseRtSearchResults = html => {
    const title = new URL(html).searchParams.get('search');
    return [{ title, year: 2020, href: title === first.title ? '/m/first' : '/m/second',
      rtCriticsScore: title === first.title ? 80 : 20 }];
  };
  api.parseRtScorecard = () => ({ rtAudienceScore: 70 });
  return calls;
}

for (const restart of [false, true]) test(`title delimiters cannot reuse another lookup's score (restart: ${restart})`, async () => {
  let worker = loadWorker(); await worker.ready; provider(worker.api);
  assert.equal((await worker.api.getRottenTomatoesRatings(first)).rtCriticsScore, 80);
  await worker.api.flushRtCache();
  if (restart) { worker = loadWorker({ local: worker.localStore }); await worker.ready; }
  const calls = provider(worker.api);
  const result = await worker.api.getRottenTomatoesRatings(second);
  assert.equal(result.rtCriticsScore, 20);
  assert.equal(result.matchedTitle, second.title);
  assert.equal(calls.length, 2, 'different title must fetch its own search and detail');
  await worker.api.flushRtCache();
});

test('delimiters cannot merge concurrent lookups with different title and original title fields', async () => {
  const worker = loadWorker(); await worker.ready;
  const left = { title: 'Alpha:2020', originalTitle: 'Beta', mediaType: 'movie' };
  const right = { title: 'Alpha', year: 2020, originalTitle: ':Beta', mediaType: 'movie' };
  const calls = provider(worker.api);
  const results = await Promise.all([worker.api.getRottenTomatoesRatings(left), worker.api.getRottenTomatoesRatings(right)]);
  assert.equal(results[0].matchedTitle, left.title);
  assert.equal(results[1].matchedTitle, right.title);
  assert.equal(calls.length, 4);
  await worker.api.flushRtCache();
});

// Literal percent sequences must not collide with the escaping of a colon.
test('literal percent sequences and colon titles remain independent', async () => {
  const worker = loadWorker(); await worker.ready; provider(worker.api);
  const left = { title: 'Alpha:Beta', year: 2020, mediaType: 'movie' };
  const right = { ...left, title: 'Alpha%3ABeta' };
  assert.equal((await worker.api.getRottenTomatoesRatings(left)).matchedTitle, left.title);
  assert.equal((await worker.api.getRottenTomatoesRatings(right)).matchedTitle, right.title);
  await worker.api.flushRtCache();
});

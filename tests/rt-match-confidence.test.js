// Rotten Tomatoes is the score that matters most here, and it comes from our
// own scraping, so a wrong match is shown as fact. Confidence decides both
// whether a score appears and whether it is marked approximate.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Config = require('../src/shared/RatingsConfig');
const { loadWorker } = require('./helpers/worker');

const score = (requested, result) => loadWorker().api.scoreRtSearchResult(result, requested);
const accepted = c => c >= Config.confidenceThreshold;

test('an exact title in the right year is certain', () => {
  const c = score({ title: 'Moana', year: 2016 }, { title: 'Moana', year: 2016 });
  assert.equal(c, 1, 'this is as sure as the method gets, so it must reach 1');
});

test('a certain match is not labelled approximate', () => {
  // The tilde means "we are not sure". While 1 was unreachable it appeared on
  // every score ever shown, which told the reader nothing.
  const c = score({ title: 'Finding Nemo', year: 2003 }, { title: 'Finding Nemo', year: 2003 });
  assert.ok(c >= 1, `a confident match scored ${c}, so every badge would read as approximate`);
});

test('a title with no year is offered but never as certain', () => {
  // Seerr withholds the year on an un-hovered card, so this is common.
  const c = score({ title: 'Moana', year: null }, { title: 'Moana', year: 2016 });
  assert.ok(accepted(c), 'an exact title is still worth showing');
  assert.ok(c < 1, 'but nothing distinguishes it from a sequel or a remake');
});

test('a loose title with no year is not shown at all', () => {
  // This is how a wrong film reaches the card: nothing rules it out.
  for (const other of ['Moana 2', 'Moana: The Musical', 'Adventures of Moana']) {
    const c = score({ title: 'Moana', year: null }, { title: other, year: 2024 });
    assert.ok(!accepted(c), `"${other}" scored ${c} with no year to rule it out`);
  }
});

test('a wrong year rules a title out however well the words match', () => {
  const c = score({ title: 'Moana', year: 2016 }, { title: 'Moana', year: 2024 });
  assert.ok(!accepted(c), `a sequel eight years later scored ${c}`);
});

test('a year one out is tolerated, since release dates differ by region', () => {
  const c = score({ title: 'Crawl', year: 2019 }, { title: 'Crawl', year: 2020 });
  assert.ok(accepted(c), 'still worth showing');
  assert.ok(c < 1, 'but not certain');
});

test('an unrelated title never passes, with or without a year', () => {
  for (const year of [2016, null]) {
    const c = score({ title: 'Moana', year }, { title: 'Schindler\'s List', year: 1993 });
    assert.ok(!accepted(c), `unrelated title scored ${c}`);
  }
});

test('confidence stays inside its range', () => {
  const cases = [
    [{ title: 'A', year: 2020 }, { title: 'A', year: 2020 }],
    [{ title: 'A', year: 1900 }, { title: 'B', year: 2030 }],
    [{ title: '', year: null }, { title: '', year: null }],
    [{ title: 'A', year: null }, { title: 'A', year: null }]
  ];
  for (const [requested, result] of cases) {
    const c = score(requested, result);
    assert.ok(c >= 0 && c <= 1, `${JSON.stringify(result)} scored ${c}`);
  }
});

// Several films can share a title exactly — Moana is a 2016 Disney film and a
// 1926 Flaherty documentary. With no year, nothing chooses between them, and
// whichever Rotten Tomatoes happens to rank first wins.
function lookup(candidates, requested) {
  const worker = loadWorker();
  worker.api.fetchRtHtml = async () => '';
  worker.api.parseRtSearchResults = () => candidates;
  worker.api.parseRtScorecard = () => ({ rtAudienceScore: 50 });
  return worker.api.getRottenTomatoesRatings(requested);
}

test('a title shared by several films is not guessed at when no year is known', async () => {
  const result = await lookup([
    { href: '/m/moana', title: 'Moana', year: 2016, rtCriticsScore: 95 },
    { href: '/m/moana_1926', title: 'Moana', year: 1926, rtCriticsScore: 33 }
  ], { title: 'Moana', mediaType: 'movie' });

  assert.equal(result, null, 'two films share the title exactly, so neither can be offered');
});

test('the same ambiguity resolves once a year is known', async () => {
  const result = await lookup([
    { href: '/m/moana', title: 'Moana', year: 2016, rtCriticsScore: 95 },
    { href: '/m/moana_1926', title: 'Moana', year: 1926, rtCriticsScore: 33 }
  ], { title: 'Moana', year: 2016, mediaType: 'movie' });

  assert.equal(result.rtCriticsScore, 95, 'the year picks the right film');
  assert.equal(result.confidence, 1);
});

test('a single exact title with no year is still offered', async () => {
  const result = await lookup([
    { href: '/m/crawl', title: 'Crawl', year: 2019, rtCriticsScore: 84 }
  ], { title: 'Crawl', mediaType: 'movie' });

  assert.equal(result.rtCriticsScore, 84, 'nothing competes with it');
  assert.ok(result.confidence < 1, 'but without a year it stays approximate');
});

test('no title tier alone can reach certainty', () => {
  // A yearless match returns its title tier unchanged, so if any tier were
  // raised to 1 an uncorroborated guess would be shown as fact.
  const worker = loadWorker();
  const source = require('./helpers/worker').workerSource();
  const fn = source.slice(source.indexOf('scoreRtSearchResult(result, requested)'));
  const tiers = [...fn.slice(0, fn.indexOf('if (!requested.year')).matchAll(/score = ([\d.]+)/g)]
    .map(m => parseFloat(m[1]));
  assert.ok(tiers.length > 0, 'expected the title tiers to be readable');
  for (const tier of tiers) assert.ok(tier < 1, `a title tier of ${tier} would be certain on its own`);

  // And the behaviour it protects.
  for (const title of ['Moana', 'Crawl', 'Finding Nemo']) {
    assert.ok(worker.api.scoreRtSearchResult({ title, year: 2016 }, { title, year: null }) < 1);
  }
});

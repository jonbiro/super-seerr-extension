const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadOverlay } = require('./helpers/overlay');

test('production ratings cache coalesces concurrent lookups and separates identities', async () => {
  const overlay = loadOverlay();
  const calls = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  overlay.setResolver(async (id, title, year, type) => {
    calls.push({ id, type }); await gate;
    return overlay.Model.createRatingsBundle({ rtCriticsScore: id === 550 ? 90 : 70, confidence: 1 });
  });
  const reads = Array.from({ length: 10 }, () => overlay.getRatings(550, 'Fight Club', 1999, 'movie'));
  reads.push(overlay.getRatings(551, 'Other', 2020, 'movie'));
  release();
  const results = await Promise.all(reads);
  assert.equal(calls.filter(call => call.id === 550).length, 1);
  assert.equal(calls.filter(call => call.id === 551).length, 1);
  assert.ok(results.slice(0, 10).every(result => result.rtCriticsScore === 90));
  assert.equal(results[10].rtCriticsScore, 70);
  assert.equal((await overlay.getRatings(550, 'Fight Club', 1999, 'movie')).rtCriticsScore, 90);
  assert.equal(calls.length, 2);
});

const Config = require('../src/shared/RatingsConfig');
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };

test('every coalesced caller receives the resolver deadline result', async () => {
  const overlay = loadOverlay();
  let release, calls = 0;
  overlay.setResolver(() => { calls++; return new Promise(resolve => { release = resolve; }); });
  const results = [];
  const first = overlay.getRatings(550, 'Fight Club', 1999, 'movie').then(value => { results.push(value); });
  const second = overlay.getRatings(550, 'Fight Club', 1999, 'movie').then(value => { results.push(value); });
  await settle();
  overlay.runTimers(Config.resolveTimeoutMs);
  await settle();
  try {
    assert.equal(calls, 1);
    assert.equal(results.length, 2, 'all callers finish when the shared deadline expires');
    assert.ok(results.every(value => value === null));
    assert.equal(overlay.ratingsCache.has('pending:movie:550'), false);
  } finally {
    release(null);
    await Promise.all([first, second]);
  }
});

test('coalesced refresh callers all retain the cached score on a provider failure', async () => {
  const overlay = loadOverlay();
  const previous = overlay.Model.createRatingsBundle({ rtCriticsScore: 80, confidence: 1 });
  overlay.ratingsCache.set('movie:550', { bundle: previous, cachedAt: Date.now() });
  let release, calls = 0;
  overlay.setResolver(async (id, title, year, type, options) => {
    calls++;
    await new Promise(resolve => { release = resolve; });
    options.outcome.conclusive = false;
    return null;
  });
  const reads = [1, 2, 3].map(() => overlay.getRatings(550, 'Fight Club', 1999, 'movie', { refresh: true }));
  await settle();
  release();
  const results = await Promise.all(reads);
  assert.equal(calls, 1);
  assert.deepEqual(results.map(bundle => bundle?.rtCriticsScore), [80, 80, 80]);
  assert.equal(overlay.ratingsCache.get('movie:550').bundle.rtCriticsScore, 80);
});

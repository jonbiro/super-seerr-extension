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

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

test('a title-only heading remains forgettable after its year is inferred for cache checks', async () => {
  const overlay = loadOverlay();
  overlay.setResolver(async () => overlay.Model.createRatingsBundle({ rtCriticsScore: 80, confidence: 1 }));
  await overlay.getRatings(null, 'Example (2021)', null, 'movie');
  assert.equal(overlay.forgetRatings([{ tmdbId: null, title: 'Example (2021)', year: null, mediaType: 'movie' }]), 1);
});

test('aborting a shared lookup settles every caller immediately and late replies cannot overwrite its retry', async () => {
  const overlay = loadOverlay(), controller = new AbortController();
  let release;
  overlay.setResolver(() => new Promise(resolve => { release = resolve; }));
  const results = [];
  const first = overlay.getRatings(550, 'Fight Club', 1999, 'movie', { signal: controller.signal }).then(value => results.push(value));
  const second = overlay.getRatings(550, 'Fight Club', 1999, 'movie').then(value => results.push(value));
  await settle();
  controller.abort();
  await settle();
  try {
    assert.equal(results.length, 2, 'abort must not wait for the provider or the 30-second deadline');
    assert.ok(results.every(value => value === null));
    assert.equal(overlay.ratingsCache.has('pending:movie:550'), false);
    overlay.setResolver(async () => overlay.Model.createRatingsBundle({ rtCriticsScore: 80, confidence: 1 }));
    assert.equal((await overlay.getRatings(550, 'Fight Club', 1999, 'movie')).rtCriticsScore, 80);
    release(overlay.Model.createRatingsBundle({ rtCriticsScore: 99, confidence: 1 }));
    await settle();
    assert.equal(overlay.ratingsCache.get('movie:550').bundle.rtCriticsScore, 80);
  } finally { release(null); await Promise.all([first, second]); }
});

test('clearing the card queue releases a running provider wait so the new page can score', async () => {
  const overlay = loadOverlay();
  overlay.context.window.innerWidth = 800; overlay.context.window.innerHeight = 600;
  const queue = overlay.context.window.createRatingQueue(1);
  const node = { isConnected: true, getBoundingClientRect: () => ({ left: 0, right: 20, top: 0, bottom: 20 }) };
  const starts = [];
  let release;
  overlay.setResolver(id => {
    starts.push(id);
    return id === 550 ? new Promise(resolve => { release = resolve; })
      : Promise.resolve(overlay.Model.createRatingsBundle({ rtCriticsScore: 70, confidence: 1 }));
  });
  const old = queue.add(node, signal => overlay.getRatings(550, 'Old page', 1999, 'movie', { signal }));
  await settle();
  queue.clear();
  const current = queue.add(node, signal => overlay.getRatings(551, 'New page', 2020, 'movie', { signal }));
  await settle();
  try {
    assert.deepEqual(starts, [550, 551], 'new page starts without waiting for the abandoned provider');
    assert.equal((await current).rtCriticsScore, 70);
    assert.equal(await old, null);
  } finally { release(null); await Promise.all([old, current]); }
});

test('an explicit refresh supersedes an ordinary lookup but coalesces other refreshes', async () => {
  const overlay = loadOverlay();
  const starts = [], releases = [];
  overlay.setResolver((id, title, year, type, options) => {
    starts.push(options.refresh === true);
    return new Promise(resolve => releases.push(resolve));
  });
  const old = overlay.getRatings(550, 'Fight Club', 1999, 'movie');
  await settle();
  const fresh = overlay.getRatings(550, 'Fight Club', 1999, 'movie', { refresh: true });
  const duplicate = overlay.getRatings(550, 'Fight Club', 1999, 'movie', { refresh: true });
  await settle();
  try {
    assert.deepEqual(starts, [false, true], 'refresh must reach the provider independently of an ordinary pending read');
    assert.equal(await old, null);
    releases[1](overlay.Model.createRatingsBundle({ rtCriticsScore: 80, confidence: 1 }));
    assert.equal((await fresh).rtCriticsScore, 80);
    assert.equal((await duplicate).rtCriticsScore, 80);
    releases[0](overlay.Model.createRatingsBundle({ rtCriticsScore: 99, confidence: 1 }));
    await settle();
    assert.equal(overlay.ratingsCache.get('movie:550').bundle.rtCriticsScore, 80);
  } finally { releases.forEach(resolve => resolve(null)); await Promise.all([old, fresh, duplicate]); }
});

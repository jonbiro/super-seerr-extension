const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loadWorker } = require('./helpers/worker');
const { loadIntegration } = require('./helpers/integration');
const tick = () => new Promise(resolve => setImmediate(resolve));
const original = { title: 'The Thing', mediaType: 'movie', year: null };
const choices = [{ tmdbId: 1, title: 'The Thing', mediaType: 'movie', year: 1982 }, { tmdbId: 2, title: 'The Thing', mediaType: 'movie', year: 2011 }];
async function worker() { const w = loadWorker({ get: async () => ({ seerrUrl: 'https://seerr.example/base' }), local: { seerrApiKey: 'secret' } }); await w.ready; return w; }

test('viewport queue starts visible cards first, limits reads, and cancels obsolete queued work', async t => {
  const page = loadIntegration(); t.after(() => page.window.close());
  page.window.eval(fs.readFileSync('src/content/RatingQueue.js', 'utf8'));
  const queue = page.window.createRatingQueue(2), starts = [], releases = [], signals = [];
  const add = (name, top) => {
    const node = page.window.document.createElement('div'); page.window.document.body.append(node);
    node.getBoundingClientRect = () => ({ top, bottom: top + 20, left: 0, right: 20 });
    return queue.add(node, signal => { starts.push(name); signals.push(signal); return new Promise(resolve => releases.push(resolve)); });
  };
  const promises = [add('far', 5000), add('visible', 20), add('near', 1000), add('also visible', 40)];
  await tick(); assert.deepEqual(starts, ['visible', 'also visible']);
  queue.clear(); assert.ok(signals.every(signal => signal.aborted));
  releases.forEach(resolve => resolve()); await Promise.all(promises); await tick();
  assert.equal(starts.length, 2, 'abandoned reads never start');
});

test('saved corrections are explicit, revalidated, server-scoped, persistent and removable', async () => {
  const w = await worker(); w.api.getMediaCandidates = async () => choices;
  assert.equal(await w.api.getSavedTitleCorrection(original), null);
  await assert.rejects(w.api.saveTitleCorrection({ original, tmdbId: 99 }), /Match changed/);
  await w.api.saveTitleCorrection({ original, tmdbId: 2 });
  assert.equal((await w.api.getSavedTitleCorrection(original)).year, 2011);
  const again = loadWorker({ get: async () => ({ seerrUrl: w.api.baseUrl }), local: w.localStore }); await again.ready;
  again.api.getMediaCandidates = async () => choices;
  assert.equal((await again.api.getSavedTitleCorrection(original)).tmdbId, 2);
  again.api.baseUrl = 'https://other.example'; assert.equal(await again.api.getSavedTitleCorrection(original), null);
  w.api.getMediaCandidates = async () => [choices[0]];
  assert.equal(await w.api.getSavedTitleCorrection(original), null, 'stale saved identity cannot bypass matching');
  await w.api.removeTitleCorrection((await w.api.getTitleCorrections())[0].key);
  assert.equal((await w.api.getTitleCorrections()).length, 0);
});

test('title picker remembers only when its explicit opt-in is selected', async t => {
  const page = loadIntegration(); t.after(() => page.window.close());
  const ui = new page.window.UIComponents();
  let selected = ui.chooseTitle(choices, { title: 'The Thing' });
  page.window.document.querySelector('.seerr-title-choice').click();
  assert.equal((await selected).rememberChoice, false);
  selected = ui.chooseTitle(choices, { title: 'The Thing' });
  page.window.document.querySelector('.seerr-title-picker input').click();
  page.window.document.querySelectorAll('.seerr-title-choice')[1].click();
  assert.equal((await selected).rememberChoice, true);
});

test('history status reads use saved IDs and server paths, keep offline entries, and never write', async () => {
  const w = await worker();
  await w.api.recordRecentAction('request', { title: 'Film', mediaType: 'movie', tmdbId: 550 });
  let reads = 0;
  w.api.getMediaStatus = async data => { reads++; assert.equal(data.tmdbId, 550); return { status: 'available_watch' }; };
  const rows = await w.api.getRecentActionStatuses();
  assert.equal(rows[0].status, 'Available'); assert.equal(rows[0].url, 'https://seerr.example/base/movie/550');
  w.api.getMediaStatus = async () => { throw new Error('offline'); };
  assert.equal((await w.api.getRecentActionStatuses())[0].status, 'Status unavailable');
  w.api.baseUrl = 'https://new.example';
  assert.equal((await w.api.getRecentActionStatuses())[0].url, null);
  assert.equal(reads, 1); assert.equal((await w.api.getRecentActions()).length, 1);
});

test('diagnostic export allowlists only states and metadata and rejects content callers', async () => {
  const w = await worker(); w.context.chrome.runtime.getManifest = () => ({ version: '3.5.10' });
  w.api.getPopupDiagnostics = async () => ({ serverUrl: 'https://private.example', token: 'secret', checks: { seerr: { state: 'error', message: 'secret' }, plex: { state: 'ok' } } });
  const report = await w.api.exportDiagnostics();
  assert.equal(report.checks.seerr, 'error'); assert.equal(report.checks.plex, 'ok');
  assert.doesNotMatch(JSON.stringify(report), /private|secret|serverUrl|token/);
  const response = await new Promise(resolve => w.api.handleMessage({ action: 'exportDiagnostics' }, { url: 'https://imdb.com/title/tt1' }, resolve));
  assert.equal(response.success, false);
});

test('cancelled session reads stop before the next endpoint and are not cached as unrated', async () => {
  const controller = new AbortController(); let calls = 0;
  const { loadOverlay } = require('./helpers/overlay');
  const overlay = loadOverlay({ fetch: async (_url, options) => { calls++; assert.ok(options.signal); controller.abort(); throw new Error('aborted'); } });
  const outcome = { signal: controller.signal };
  await overlay.fetchSeerrSessionRatings(550, 'movie', null, outcome);
  assert.equal(calls, 1); assert.equal(outcome.conclusive, false);
});

test('a later page visit applies its saved choice without sending a request', async t => {
  const page = loadIntegration({ sendMessage: async message => {
    assert.notEqual(message.action, 'requestMedia');
    return { success: true, data: message.action === 'getSavedTitleCorrection' ? choices[1] : { status: 'available' } };
  } }); t.after(() => page.window.close());
  const integration = new page.window.BaseIntegration('Probe', { uiTheme: 'flyout' });
  integration.extractMediaData = async () => original;
  await integration.extractAndSetup();
  assert.equal(integration.mediaData.tmdbId, 2); assert.equal(integration.mediaData.year, 2011);
  integration.destroy();
});

test('aging cached card refreshes also obey the four-read queue limit', async () => {
  const { loadOverlay } = require('./helpers/overlay');
  const overlay = loadOverlay();
  const full = overlay.Model.createRatingsBundle({ rtCriticsScore: 80, rtAudienceScore: 80, imdbRating: 8, tmdbRating: 8, confidence: 1 });
  overlay.setResolver(async () => full);
  for (let id = 1; id <= 10; id++) {
    await overlay.getRatings(id, 'Film', 2020, 'movie');
    overlay.ratingsCache.get(`movie:${id}`).retryAt = 0;
  }
  let started = 0; const release = [];
  overlay.setResolver(() => { started++; return new Promise(resolve => release.push(resolve)); });
  const node = { isConnected: true, getBoundingClientRect: () => ({ top: 0, bottom: 10, left: 0, right: 10 }) };
  const cached = await Promise.all(Array.from({ length: 10 }, (_, i) => overlay.getRatings(i + 1, 'Film', 2020, 'movie', { queueNode: node })));
  assert.ok(cached.every(bundle => bundle.rtCriticsScore === 80));
  await tick(); assert.equal(started, 4);
  overlay.cleanupOverlay();
  release.forEach(resolve => resolve(full)); await tick();
  assert.equal(started, 4, 'navigation discards pending refreshes');
});

test('saved correction read cannot cross a server change while storage is pending', async () => {
  const w = await worker();
  const key = w.api.correctionKey(original);
  let release;
  w.api.getTitleCorrections = () => new Promise(resolve => { release = resolve; });
  let searches = 0;
  w.api.getMediaCandidates = async () => { searches++; return choices; };
  const pending = w.api.getSavedTitleCorrection(original);
  w.api.baseUrl = 'https://other.example';
  release([{key, title:original.title, tmdbId:2}]);
  assert.equal(await pending, null);
  assert.equal(searches, 0, 'old-server choices must not be revalidated against the new server');
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker } = require('./helpers/worker');
const sender = { url: 'chrome-extension://test/src/options/options.html' };
const first = 'https://home.example/base';
const second = 'https://family.example';
const message = (w, action, data, from = sender, extra = {}) => new Promise(resolve => w.api.handleMessage({ action, data, ...extra }, from, resolve));
async function setup() {
  const worker = loadWorker({ get: async () => ({ seerrUrl: first }), local: { seerrApiKey: 'home-secret' } });
  await worker.ready; return worker;
}
const addSecond = worker => message(worker, 'saveSeerrConnection', { url: second, apiKey: 'family-secret', name: 'Family' });

for (const operation of ['saveTitleCorrection', 'getSavedTitleCorrection']) {
  for (const stage of operation === 'saveTitleCorrection' ? ['candidates', 'queue', 'storage'] : ['candidates', 'storage']) {
    test(`${operation} discards an in-flight ${stage} result after switching away and back`, async () => {
      const w = await setup(); await addSecond(w);
      const original = { title: 'The Thing', mediaType: 'movie' };
      const choices = [{ tmdbId: 2, title: 'The Thing', mediaType: 'movie', year: 2011 }];
      w.api.getMediaCandidates = async () => choices;
      await w.api.saveTitleCorrection({ original, tmdbId: 2 });
      const saved = JSON.stringify(w.localStore.titleCorrectionsV1);
      let finish, started;
      const entered = new Promise(resolve => { started = resolve; });
      const gate = new Promise(resolve => { finish = resolve; });
      if (stage === 'candidates') w.api.getMediaCandidates = () => { started(); return gate.then(() => choices); };
      else if (stage === 'queue') w.api.queueRecentAction(() => { started(); return gate; });
      else {
        const read = w.api.getTitleCorrections.bind(w.api);
        w.api.getTitleCorrections = async () => { const rows = await read(); started(); await gate; return rows; };
      }
      const pending = w.api[operation](operation === 'saveTitleCorrection' ? { original, tmdbId: 2 } : original);
      // Attach the rejection handler before deliberately invalidating the operation.
      const result = operation === 'saveTitleCorrection' ? assert.rejects(pending, /changed/i) : pending;
      await entered;
      await message(w, 'activateSeerrConnection', { id: first });
      await message(w, 'activateSeerrConnection', { id: second });
      const writeCount = w.localWrites.length;
      finish();
      if (operation === 'getSavedTitleCorrection') assert.equal(await result, null);
      else await result;
      assert.equal(w.localWrites.length, writeCount, 'a stale choice must not be persisted');
      assert.equal(JSON.stringify(w.localStore.titleCorrectionsV1), saved);
    });
  }
}

test('changing the active site API key invalidates a pending saved title choice', async () => {
  const w = await setup(); await addSecond(w);
  let finish;
  w.api.getMediaCandidates = () => new Promise(resolve => { finish = resolve; });
  const pending = w.api.saveTitleCorrection({ original: { title: 'Example', mediaType: 'movie' }, tmdbId: 1 });
  const rejected = assert.rejects(pending, /changed/i);
  await message(w, 'saveSeerrConnection', { id: second, url: second, apiKey: 'replacement-key' });
  finish([{ tmdbId: 1, title: 'Example', mediaType: 'movie' }]);
  await rejected;
  assert.equal(w.localStore.titleCorrectionsV1, undefined);
});

for (const action of ['requestMedia', 'addToWatchlist', 'getSeasonOptions']) {
  for (const stage of ['identity', 'search']) {
    test(`${action} stops an in-flight ${stage} check after switching away and back`, async () => {
      const w = await setup(); await addSecond(w);
      let finish, calls = 0;
      const gate = new Promise(resolve => { finish = resolve; });
      w.api.tmdbIdentityMatches = () => gate;
      w.api.resolveMediaMatch = () => gate;
      w.api.makeAPIRequest = w.api.sendAPIRequest = async () => { calls++; return { id: 1, seasons: [] }; };
      const pending = w.api[action]({ title: 'Example', mediaType: action === 'getSeasonOptions' ? 'tv' : 'movie', ...(stage === 'identity' ? { tmdbId: 1 } : {}) });
      await message(w, 'activateSeerrConnection', { id: first });
      await message(w, 'activateSeerrConnection', { id: second });
      finish(stage === 'identity' ? true : { id: 1 });
      await assert.rejects(pending, /Settings changed/);
      assert.equal(calls, 0, 'a new review is required before any further API call');
    });
  }
}

test('adding a second site retains legacy credentials, switches atomically, and survives restart', async () => {
  const w = await setup();
  const before = await message(w, 'getSeerrConnections');
  assert.equal(before.data.activeId, first);
  const saved = await addSecond(w);
  assert.equal(saved.success, true); assert.equal(saved.data.sites.length, 2);
  assert.doesNotMatch(JSON.stringify(saved), /home-secret|family-secret|apiKey/);
  assert.equal(w.api.baseUrl, second); assert.equal(w.api.apiKey, 'family-secret');
  assert.equal(w.localStore.seerrApiKey, '', 'legacy secret retires after the profiles are committed');
  assert.equal(w.localStore.seerrConnectionsV1.sites.find(site => site.id === first).apiKey, 'home-secret');
  assert.ok(w.writes.every(value => !JSON.stringify(value).includes('secret')));
  await message(w, 'activateSeerrConnection', { id: first });
  assert.equal(w.api.baseUrl, first); assert.equal(w.api.apiKey, 'home-secret');
  const restarted = loadWorker({ get: async () => ({ seerrUrl: 'https://stale.example' }), local: w.localStore });
  await restarted.ready;
  assert.equal(restarted.api.baseUrl, first); assert.equal(restarted.api.apiKey, 'home-secret');
});

test('each selected site sends its own key and invalidates cached status reads', async () => {
  const w = await setup(); await addSecond(w);
  let calls = 0;
  w.context.fetch = async (url, options) => {
    calls++; return { ok: true, json: async () => ({ url, key: options.headers['X-Api-Key'] }) };
  };
  assert.equal((await w.api.makeAPIRequest('GET', '/api/v1/movie/1')).key, 'family-secret');
  assert.equal((await w.api.makeAPIRequest('GET', '/api/v1/movie/1')).key, 'family-secret');
  assert.equal(calls, 1);
  await message(w, 'activateSeerrConnection', { id: first });
  const result = await w.api.makeAPIRequest('GET', '/api/v1/movie/1');
  assert.equal(result.key, 'home-secret'); assert.equal(result.url, `${first}/api/v1/movie/1`);
});

test('stale title reviews and inactive saved-site overlays cannot write to a newly active server', async () => {
  const w = await setup(); await addSecond(w);
  const oldToken = w.api.connectionToken();
  await message(w, 'activateSeerrConnection', { id: first });
  let writes = 0; w.api.requestMedia = async () => { writes++; return {}; };
  const request = { tmdbId: 1, mediaType: 'movie', title: 'Example' };
  const stale = await message(w, 'requestMedia', request, { url: 'https://www.imdb.com/title/tt1' }, { connectionToken: oldToken });
  assert.equal(stale.success, false); assert.match(stale.error, /site changed/);
  const overlay = await message(w, 'requestMedia', request, { url: `${second}/movie/1`, tab: { id: 1 } });
  assert.equal(overlay.success, false); assert.match(overlay.error, /not the active/);
  assert.equal(writes, 0);
  await message(w, 'activateSeerrConnection', { id: second });
  assert.equal((await message(w, 'requestMedia', request, sender, { connectionToken: oldToken })).success, false, 'switching back still invalidates the old review');
});

test('site management is trusted-only and rejects duplicate or unsafe destinations', async () => {
  const w = await setup();
  for (const action of ['getSeerrConnections', 'saveSeerrConnection', 'activateSeerrConnection', 'removeSeerrConnection']) {
    assert.equal((await message(w, action, { url: second }, { url: 'https://www.imdb.com/title/tt1' })).success, false);
  }
  for (const url of [first + '/', 'https://user:pass@bad.example', 'file:///tmp', 'https://bad.example?secret=1']) {
    assert.equal((await message(w, 'saveSeerrConnection', { url })).success, false);
  }
  assert.equal(w.localStore.seerrConnectionsV1, undefined);
});

for (const malformed of [
  { revision: 4, activeId: 'broken', sites: [{ id: 'broken', url: 'javascript:alert(1)', apiKey: 'unsafe-secret' }] },
  { revision: 4, activeId: 'home', sites: [{ id: 'home', url: 'https://home.example', apiKey: '' }, { id: 'family', url: 'https://home.example/', apiKey: '' }] },
  0, 'not-a-profile', []
]) test(`a malformed saved site (${typeof malformed}) fails closed instead of becoming the active destination`, async () => {
  const w = loadWorker({ get: async () => ({ seerrUrl: 'https://legacy.example' }), local: {
    seerrApiKey: 'legacy-secret', seerrConnectionsV1: malformed
  }});
  await w.ready;
  const config = await message(w, 'getConfigState');
  assert.equal(config.success, true);
  assert.equal(config.data.serverUrl, null);
  assert.equal(config.data.apiConfigured, false);
  assert.equal(w.api.baseUrl, null);
  assert.equal(w.api.apiKey, null);
});

test('site edits, removals, and queued concurrent additions preserve other credentials', async () => {
  const w = await setup();
  const results = await Promise.all([addSecond(w), message(w, 'saveSeerrConnection', { url: 'https://third.example', apiKey: 'third-secret' })]);
  assert.ok(results.every(reply => reply.success));
  assert.equal(w.localStore.seerrConnectionsV1.sites.length, 3);
  assert.equal((await message(w, 'removeSeerrConnection', { id: 'https://third.example' })).success, false);
  await message(w, 'saveSeerrConnection', { id: second, url: second, name: 'Family renamed', apiKey: 'new-secret' });
  assert.equal(w.api.apiKey, 'new-secret');
  await message(w, 'removeSeerrConnection', { id: first });
  assert.equal(w.localStore.seerrConnectionsV1.sites.some(site => site.id === first), false);
  assert.doesNotMatch(JSON.stringify(w.localStore), /home-secret/);
});

test('removing a site that disappeared concurrently does not create a fake successful revision', async () => {
  const w = await setup(); await addSecond(w);
  const before = w.localStore.seerrConnectionsV1.revision;
  const reply = await message(w, 'removeSeerrConnection', { id: 'https://missing.example' });
  assert.equal(reply.success, false);
  assert.match(reply.error, /removed/i);
  assert.equal(w.localStore.seerrConnectionsV1.revision, before);
});

test('failed profile storage leaves the selected server and saved credentials unchanged', async () => {
  const w = await setup(); await addSecond(w);
  w.context.chrome.storage.local.set = async () => { throw new Error('Quota exceeded'); };
  assert.equal((await message(w, 'activateSeerrConnection', { id: first })).success, false);
  assert.equal(w.localStore.seerrConnectionsV1.activeId, second);
  assert.equal(w.api.baseUrl, second); assert.equal(w.api.apiKey, 'family-secret');
});

test('a denied popup host permission keeps the original active site and re-enables switching', async t => {
  const { JSDOM } = require('jsdom');
  const fs = require('node:fs');
  const dom = new JSDOM(fs.readFileSync('src/popup/popup.html', 'utf8'), { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const calls = [];
  dom.window.chrome = { permissions: { request: async () => false }, runtime: { sendMessage: async request => {
    calls.push(request.action);
    return { success: true, data: { activeId: first, sites: [{ id: first, name: 'Home', url: first }, { id: second, name: 'Family', url: second }] } };
  } } };
  dom.window.eval(fs.readFileSync('src/popup/connections.js', 'utf8'));
  await new Promise(resolve => setImmediate(resolve));
  const select = dom.window.document.getElementById('activeSeerrSite');
  select.value = second; select.dispatchEvent(new dom.window.Event('change'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(select.value, first); assert.equal(select.disabled, false);
  assert.deepEqual(calls, ['getSeerrConnections']);
  assert.match(dom.window.document.getElementById('siteSwitchStatus').textContent, /declined/);
});

test('an inactive nested Seerr site cannot inherit the active parent site configuration or cache', async () => {
  const w = await setup();
  await message(w, 'saveSeerrConnection', { url: 'https://home.example', apiKey: 'root-key' });
  // The original /base site is now inactive, though its path falls under /.
  const nestedPage = { id: 'test', url: `${first}/discover`, tab: { id: 1 }, frameId: 0 };
  const config = await message(w, 'getConfigState', undefined, nestedPage);
  assert.equal(config.data.serverUrl, null);
  assert.equal(config.data.apiConfigured, false);
  for (const action of ['getOverlayCache', 'putOverlayCache', 'getFilterPresets']) {
    assert.equal((await message(w, action, {}, nestedPage)).success, false, action);
  }
  const rootPage = { ...nestedPage, url: 'https://home.example/discover' };
  assert.equal((await message(w, 'getConfigState', undefined, rootPage)).data.serverUrl, 'https://home.example');
  // Prefix neighbors are still on the parent site, not the /base installation.
  assert.equal((await message(w, 'getConfigState', undefined, { ...rootPage, url: 'https://home.example/baseball' })).data.serverUrl, 'https://home.example');
  await message(w, 'activateSeerrConnection', { id: first });
  assert.equal((await message(w, 'getConfigState', undefined, nestedPage)).data.serverUrl, first);
});

test('SPA messages use the current tab URL instead of the original parent document', async () => {
  const w = await setup();
  await message(w, 'saveSeerrConnection', { url: 'https://home.example', apiKey: 'root-key' });
  const originalSender = { id: 'test', url: 'https://home.example/discover', tab: { id: 1 }, frameId: 0 };
  let url = `${first}/discover`, writes = 0;
  w.context.chrome.tabs = { get: async () => ({ id: 1, url }) };
  w.api.requestMedia = async () => { writes++; return { tmdbId: 550 }; };
  const config = await message(w, 'getConfigState', undefined, originalSender);
  assert.equal(config.data.serverUrl, null); assert.equal(config.data.apiConfigured, false);
  for (const action of ['getOverlayCache', 'requestMedia', 'getRottenTomatoesRatings']) {
    const reply = await message(w, action, { tmdbId: 550, title: 'Fight Club', year: 1999, mediaType: 'movie' }, originalSender);
    assert.equal(reply.success, false); assert.match(reply.error, /not the active/, action);
  }
  assert.equal(writes, 0);
  url = 'https://home.example/discover';
  assert.equal((await message(w, 'getConfigState', undefined, originalSender)).data.serverUrl, 'https://home.example');
  url = 'https://other.example/discover';
  assert.match((await message(w, 'getConfigState', undefined, originalSender)).error, /page changed/);
  w.context.chrome.tabs.get = async () => { throw new Error('Tab closed'); };
  assert.equal((await message(w, 'requestMedia', {}, originalSender)).success, false);
  assert.equal(writes, 0);
});

test('same-origin pages outside a saved nested site cannot use its active configuration', async () => {
  const w = await setup();
  let writes = 0;
  w.api.requestMedia = async () => { writes++; return { tmdbId: 1 }; };
  w.context.chrome.tabs = { get: async () => ({ id: 1, url: 'https://home.example/other-page' }) };
  const sender = { id: 'test', tab: { id: 1 }, frameId: 0, url: `${first}/discover` };

  const config = await message(w, 'getConfigState', undefined, sender);
  assert.equal(config.success, false);
  assert.match(config.error, /page changed/i);
  const request = await message(w, 'requestMedia', { tmdbId: 1, mediaType: 'movie', title: 'Example' }, sender);
  assert.equal(request.success, false);
  assert.match(request.error, /page changed/i);
  assert.equal(writes, 0);
});

test('inactive nested pages cannot invoke Plex watchlist actions', async () => {
  const w = await setup();
  await addSecond(w);
  await message(w, 'activateSeerrConnection', { id: first });
  let adds = 0;
  w.api.plexAddToWatchlist = async () => { adds++; return { already: false }; };
  const inactive = { id: 'test', tab: { id: 1 }, frameId: 0, url: `${second}/discover` };
  const reply = await message(w, 'plexAddToWatchlist', { tmdbId: 1, mediaType: 'movie', title: 'Example' }, inactive);
  assert.equal(reply.success, false);
  assert.match(reply.error, /not the active/i);
  assert.equal(adds, 0);
});

test('a stale Plex action cannot write after switching back to the original site', async () => {
  const w = await setup();
  await addSecond(w);
  const oldToken = w.api.connectionToken();
  await message(w, 'activateSeerrConnection', { id: first });
  let adds = 0;
  w.api.plexAddToWatchlist = async () => { adds++; return { already: false }; };
  const reply = await message(w, 'plexAddToWatchlist', { tmdbId: 1, mediaType: 'movie', title: 'Example' }, sender, { connectionToken: oldToken });
  assert.equal(reply.success, false);
  assert.match(reply.error, /site changed/i);
  assert.equal(adds, 0);
});

test('popup uses the confirmed switch result even if subsequent history reads fail', async t => {
  const { JSDOM } = require('jsdom');
  const fs = require('node:fs');
  const dom = new JSDOM(fs.readFileSync('src/popup/popup.html', 'utf8'), { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const sites = [{ id: first, name: 'Home', url: first }, { id: second, name: 'Family', url: second }];
  let activeId = first, changed, reads = 0;
  dom.window.chrome = { storage: { onChanged: { addListener: listener => { changed = listener; } } }, permissions: { request: async () => true }, runtime: { sendMessage: async ({ action }) => {
    if (action === 'activateSeerrConnection') {
      activeId = second;
      const data = { revision: 2, activeId, sites };
      changed?.({ seerrConnectionsV1: { newValue: data } }, 'local');
      return { success: true, data };
    }
    reads++;
    if (activeId === second) throw new Error('Worker disconnected');
    return { success: true, data: { revision: 1, activeId, sites } };
  } } };
  dom.window.eval(fs.readFileSync('src/popup/connections.js', 'utf8'));
  await new Promise(resolve => setImmediate(resolve));
  const select = dom.window.document.getElementById('activeSeerrSite');
  select.value = second; select.dispatchEvent(new dom.window.Event('change'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(select.value, second);
  assert.equal(select.disabled, false);
  assert.match(dom.window.document.getElementById('siteSwitchStatus').textContent, /Site switched/);
  assert.equal(reads, 1, 'the matching storage notification does not reread a confirmed switch');
});

test('an open popup follows site changes made in Settings', async t => {
  const { JSDOM } = require('jsdom');
  const fs = require('node:fs');
  const dom = new JSDOM(fs.readFileSync('src/popup/popup.html', 'utf8'), { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const sites = [{ id: first, name: 'Home', url: first }, { id: second, name: 'Family', url: second }];
  let activeId = first, changed;
  dom.window.chrome = { storage: { onChanged: { addListener: listener => { changed = listener; } } }, runtime: {
    sendMessage: async () => ({ success: true, data: { activeId, sites } })
  } };
  dom.window.eval(fs.readFileSync('src/popup/connections.js', 'utf8'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof changed, 'function');
  activeId = second; changed({ seerrConnectionsV1: {} }, 'local');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dom.window.document.getElementById('activeSeerrSite').value, second);
});

test('a delayed popup list cannot restore an older active site after a settings change', async t => {
  const { JSDOM } = require('jsdom');
  const fs = require('node:fs');
  const dom = new JSDOM(fs.readFileSync('src/popup/popup.html', 'utf8'), { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const sites = [{ id: first, name: 'Home', url: first }, { id: second, name: 'Family', url: second }];
  let changed, finishInitial, reads = 0;
  dom.window.chrome = { storage: { onChanged: { addListener: listener => { changed = listener; } } }, runtime: {
    sendMessage: () => ++reads === 1 ? new Promise(resolve => { finishInitial = resolve; })
      : Promise.resolve({ success: true, data: { revision: 2, activeId: second, sites } })
  } };
  dom.window.eval(fs.readFileSync('src/popup/connections.js', 'utf8'));
  changed({ seerrConnectionsV1: { newValue: { revision: 2, activeId: second } } }, 'local');
  await new Promise(resolve => setImmediate(resolve));
  finishInitial({ success: true, data: { revision: 1, activeId: first, sites } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dom.window.document.getElementById('activeSeerrSite').value, second);
  assert.equal(dom.window.document.getElementById('activeSeerrSite').title, second);
});

test('advertised saved-site capacity matches enforcement and permits edits at capacity', async () => {
  const w = await setup();
  for (let i = 1; i < 10; i++) {
    assert.equal((await message(w, 'saveSeerrConnection', { url: `https://site-${i}.example`, apiKey: `fixture-${i}` })).success, true);
  }
  const full = await message(w, 'getSeerrConnections');
  assert.equal(full.data.maxSites, 10);
  assert.equal(full.data.sites.length, full.data.maxSites);
  const overflow = await message(w, 'saveSeerrConnection', { url: 'https://overflow.example', apiKey: 'overflow-key' });
  assert.equal(overflow.success, false);
  assert.match(overflow.error, /up to 10/);
  assert.equal(w.localStore.seerrConnectionsV1.sites.length, 10);
  assert.equal((await message(w, 'saveSeerrConnection', { id: first, url: first, name: 'Edited at capacity', apiKey: 'edited-key' })).success, true);
  assert.equal(w.localStore.seerrConnectionsV1.sites.length, 10);
  assert.equal(w.api.apiKey, 'edited-key');
  assert.equal((await message(w, 'removeSeerrConnection', { id: 'https://site-9.example' })).success, true);
  assert.equal((await message(w, 'saveSeerrConnection', { url: 'https://replacement.example', apiKey: 'replacement-key' })).success, true);
  assert.equal(w.localStore.seerrConnectionsV1.sites.length, 10);
});

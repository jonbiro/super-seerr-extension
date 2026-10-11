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

test('popup uses the confirmed switch result even if subsequent history reads fail', async t => {
  const { JSDOM } = require('jsdom');
  const fs = require('node:fs');
  const dom = new JSDOM(fs.readFileSync('src/popup/popup.html', 'utf8'), { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const sites = [{ id: first, name: 'Home', url: first }, { id: second, name: 'Family', url: second }];
  let activeId = first, notifications = 0, changed, reads = 0;
  dom.window.addEventListener('seerrConnectionChanged', () => notifications++);
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
  assert.equal(notifications, 1);
  assert.equal(reads, 1, 'the matching storage notification does not reread a confirmed switch');
});

test('an open popup follows site changes made in Settings', async t => {
  const { JSDOM } = require('jsdom');
  const fs = require('node:fs');
  const dom = new JSDOM(fs.readFileSync('src/popup/popup.html', 'utf8'), { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const sites = [{ id: first, name: 'Home', url: first }, { id: second, name: 'Family', url: second }];
  let activeId = first, changed, notifications = 0;
  dom.window.addEventListener('seerrConnectionChanged', () => notifications++);
  dom.window.chrome = { storage: { onChanged: { addListener: listener => { changed = listener; } } }, runtime: {
    sendMessage: async () => ({ success: true, data: { activeId, sites } })
  } };
  dom.window.eval(fs.readFileSync('src/popup/connections.js', 'utf8'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof changed, 'function');
  activeId = second; changed({ seerrConnectionsV1: {} }, 'local');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dom.window.document.getElementById('activeSeerrSite').value, second);
  assert.equal(notifications, 1);
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

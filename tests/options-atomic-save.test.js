const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const { loadWorker } = require('./helpers/worker');
const { createStorageMock } = require('./helpers/chrome-mock');
const oldServer = 'https://home.example', newServer = 'https://family.example';
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function fixture(t, { legacyUrl = oldServer } = {}) {
  const sync = createStorageMock({ seerrUrl: legacyUrl });
  const worker = loadWorker({ get: sync.get, local: { seerrApiKey: 'home-key' },
    grantedOrigins: [`${oldServer}/*`, `${newServer}/*`] });
  await worker.ready;
  const dom = new JSDOM(fs.readFileSync('src/options/options.html', 'utf8'), {
    url: 'chrome-extension://test/src/options/options.html', runScripts: 'outside-only'
  });
  t.after(() => dom.window.close());
  const listeners = [];
  const publish = (value, area) => {
    const changes = Object.fromEntries(Object.entries(value).map(([key, newValue]) => [key, { newValue }]));
    worker.listeners.storage(changes, area);
    for (const listener of listeners) listener(changes, area);
  };
  worker.context.chrome.storage.sync.set = async value => { await sync.set(value); publish(value, 'sync'); };
  const setLocal = worker.context.chrome.storage.local.set;
  worker.context.chrome.storage.local.set = async value => { await setLocal(value); publish(value, 'local'); };
  const requests = [];
  worker.context.fetch = async (url, options = {}) => {
    requests.push({ url, key: options.headers?.['X-Api-Key'] });
    return { ok: true, status: 200, json: async () => ({ id: 1 }) };
  };
  dom.window.chrome = {
    storage: { sync: worker.context.chrome.storage.sync, local: worker.context.chrome.storage.local,
      onChanged: { addListener: listener => listeners.push(listener) } },
    permissions: { contains: async () => true, request: async () => true },
    runtime: { sendMessage: request => new Promise(resolve => worker.listeners.message(request,
      { id: 'test', url: dom.window.location.href }, resolve)) }
  };
  dom.window.eval(fs.readFileSync('src/options/options.js', 'utf8').split('// Initialize when DOM is loaded')[0] +
    '\nwindow.manager = new OptionsManager();');
  await settle();
  const doc = dom.window.document;
  doc.getElementById('serverUrl').value = newServer;
  doc.getElementById('apiKey').value = 'family-key';
  assert.equal(doc.getElementById('seerrSiteName').value, '', 'exercise the unnamed single-site save');
  return { worker, dom, doc, sync, requests };
}

for (const phase of ['pending', 'failed', 'completed']) test(`an unnamed single-site save never mixes the URL and API key (${phase})`, async t => {
  const f = await fixture(t), entered = deferred(), gate = deferred();
  const setLocal = f.worker.context.chrome.storage.local.set;
  f.worker.context.chrome.storage.local.set = async value => {
    if ('seerrApiKey' in value || 'seerrConnectionsV1' in value) {
      entered.resolve(); await gate.promise;
      if (phase === 'failed') throw new Error('Local storage unavailable');
    }
    await setLocal(value);
  };
  const saving = f.dom.window.manager.saveSettings();
  try {
    await entered.promise;
    if (phase === 'pending') {
      await f.worker.api.loadSettings();
      await f.worker.api.getSeerrAccount();
      assert.deepEqual(f.requests.filter(row => row.key).at(-1), {
        url: `${oldServer}/api/v1/auth/me`, key: 'home-key'
      }, 'the existing complete connection stays active until the new pair is persisted');
    }
  } finally { gate.resolve(); await saving; }
  await f.worker.api.loadSettings();
  await f.worker.api.getSeerrAccount();
  const expectedServer = phase === 'failed' ? oldServer : newServer;
  const expectedKey = phase === 'failed' ? 'home-key' : 'family-key';
  assert.deepEqual(f.requests.filter(row => row.key).at(-1), { url: `${expectedServer}/api/v1/auth/me`, key: expectedKey });
  const restarted = loadWorker({ get: f.sync.get, local: f.worker.localStore });
  await restarted.ready;
  assert.equal(restarted.api.baseUrl, expectedServer);
  assert.equal(restarted.api.apiKey, expectedKey);
  assert.equal(f.doc.getElementById('serverUrl').value, newServer, 'a failed save preserves the draft');
  assert.equal(f.doc.getElementById('apiKey').value, 'family-key');
});

for (const failure of ['sync preferences', 'local preferences', 'refresh']) test(`a committed connection is reported accurately after ${failure} fails`, async t => {
  const f = await fixture(t);
  if (failure === 'sync preferences') f.worker.context.chrome.storage.sync.set = async () => { throw new Error('Sync unavailable'); };
  else if (failure === 'local preferences') {
    const set = f.worker.context.chrome.storage.local.set;
    f.worker.context.chrome.storage.local.set = async value => {
      if ('plexToken' in value) throw new Error('Local preferences unavailable');
      await set(value);
    };
  } else {
    const get = f.worker.context.chrome.storage.local.get;
    f.worker.context.chrome.storage.local.get = async keys => {
      if (keys === 'seerrConnectionsV1' && f.worker.localStore.seerrConnectionsV1) throw new Error('Refresh unavailable');
      return get(keys);
    };
  }
  await f.dom.window.manager.saveSettings();
  assert.equal(f.worker.api.baseUrl, newServer);
  assert.equal(f.worker.api.apiKey, 'family-key');
  assert.equal(f.worker.localWrites.filter(value => value.seerrConnectionsV1).length, 1, 'a failed follow-up cannot repeat the committed save');
  assert.match(f.doc.getElementById('status').textContent, failure === 'refresh'
    ? /Settings saved, but.*could not be refreshed.*Reload/
    : /Seerr site saved, but some other settings could not be saved/);
  assert.equal(f.dom.window.manager.connectionId, newServer);
  assert.equal(f.doc.getElementById('apiKey').value, 'family-key');
  assert.ok(!JSON.stringify(f.sync._dump()).includes('family-key'), 'the connection key stays local');
});

for (const legacyUrl of ['not a URL', 'javascript:alert(1)', 'https://user:password@old.example']) {
  test(`an invalid legacy URL cannot block an explicitly corrected connection (${legacyUrl})`, async t => {
    const f = await fixture(t, { legacyUrl });
    await f.dom.window.manager.saveSettings();
    assert.equal(f.worker.api.baseUrl, newServer);
    assert.equal(f.worker.api.apiKey, 'family-key');
    assert.equal(f.worker.localStore.seerrConnectionsV1.sites.length, 1);
    assert.match(f.doc.getElementById('status').textContent, /Settings saved successfully/);
  });
}

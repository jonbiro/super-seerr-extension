const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };

async function fixture(t) {
  const dom = new JSDOM(fs.readFileSync('src/options/options.html', 'utf8'), {
    url: 'https://extension.example/options', runScripts: 'outside-only'
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  const profiles = { revision: 1, activeId: 'home', sites: [
    { id: 'home', name: 'Home', url: 'https://home.example/', apiKey: 'home-key' },
    { id: 'family', name: 'Family', url: 'https://family.example/', apiKey: 'family-key' }
  ] };
  const reply = () => ({ success: true, data: profiles });
  const messages = [];
  window.chrome = {
    storage: { onChanged: { addListener() {} }, sync: { get: async () => ({}) },
      local: { get: async () => ({ seerrConnectionsV1: profiles }) } },
    permissions: { contains: async () => true, request: async () => true },
    runtime: { sendMessage: async message => { messages.push(message); return reply(); } }
  };
  window.eval(fs.readFileSync('src/options/options.js', 'utf8').split('// Initialize when DOM is loaded')[0] +
    '\nwindow.manager = new OptionsManager();');
  await settle();
  const doc = window.document;
  doc.getElementById('savedSeerrSites').value = 'family';
  doc.getElementById('savedSeerrSites').dispatchEvent(new window.Event('change'));
  await settle();
  doc.getElementById('apiKey').value = 'unsaved-family-key';
  return { window, doc, manager: window.manager, messages, reply };
}

for (const failure of ['worker error', 'missing reply', 'malformed reply', 'transport error']) {
  test(`saved-site ${failure} shows a retry and preserves the draft through recovery`, async t => {
    const f = await fixture(t);
    assert.equal(f.doc.getElementById('useSeerrSite').disabled, false);
    f.window.chrome.runtime.sendMessage = async () => {
      if (failure === 'transport error') throw new Error('Worker unavailable');
      return failure === 'worker error' ? { success: false } : failure === 'missing reply' ? undefined : { success: true, data: {} };
    };
    await f.manager.loadConnectionChoices();
    assert.equal(f.doc.getElementById('seerrSitesError').classList.contains('hidden'), false);
    assert.equal(f.doc.getElementById('useSeerrSite').disabled, true);
    assert.equal(f.doc.getElementById('removeSeerrSite').disabled, true);
    assert.equal(f.doc.getElementById('retrySeerrSites').disabled, false);
    assert.equal(f.doc.getElementById('apiKey').value, 'unsaved-family-key');
    assert.equal(f.doc.getElementById('savedSeerrSites').value, 'family');
    f.window.chrome.runtime.sendMessage = async message => { f.messages.push(message); return f.reply(); };
    const before = f.messages.length;
    await f.manager.useConnection(); await f.manager.removeConnection();
    assert.equal(f.messages.length, before, 'unavailable site state cannot send switch or removal actions');
    f.doc.getElementById('retrySeerrSites').click();
    await settle();
    assert.equal(f.doc.getElementById('seerrSitesError').classList.contains('hidden'), true);
    assert.equal(f.doc.getElementById('useSeerrSite').disabled, false);
    assert.equal(f.doc.getElementById('removeSeerrSite').disabled, false);
    assert.equal(f.doc.getElementById('apiKey').value, 'unsaved-family-key');
    assert.equal(f.doc.getElementById('savedSeerrSites').value, 'family');
  });
}

for (const late of ['success', 'failure']) test(`obsolete site-list ${late} cannot replace a newer result`, async t => {
  const f = await fixture(t);
  let resolveOld, rejectOld;
  f.window.chrome.runtime.sendMessage = () => new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject; });
  const old = f.manager.loadConnectionChoices();
  f.window.chrome.runtime.sendMessage = async () => late === 'failure' ? f.reply() : { success: false };
  await f.manager.loadConnectionChoices();
  if (late === 'failure') rejectOld(new Error('Old failure'));
  else resolveOld(f.reply());
  await old;
  assert.equal(f.doc.getElementById('seerrSitesError').classList.contains('hidden'), late === 'failure');
  assert.equal(f.doc.getElementById('useSeerrSite').disabled, late === 'success');
  assert.equal(f.doc.getElementById('retrySeerrSites').disabled, false);
  assert.equal(f.doc.getElementById('apiKey').value, 'unsaved-family-key');
});

for (const outcome of ['success', 'failure']) test(`site-list refresh preserves a pending selection until its ${outcome}`, async t => {
  const f = await fixture(t);
  const localGet = f.window.chrome.storage.local.get;
  let resolve, reject;
  f.window.chrome.storage.local.get = () => new Promise((a, b) => { resolve = a; reject = b; });
  f.doc.getElementById('savedSeerrSites').value = 'home';
  const editing = f.manager.editConnection();
  await f.manager.loadConnectionChoices();
  assert.equal(f.doc.getElementById('savedSeerrSites').value, 'home', 'metadata refresh cannot reset the pending choice');
  if (outcome === 'success') resolve(await localGet());
  else reject(new Error('Storage unavailable'));
  await editing;
  assert.equal(f.doc.getElementById('savedSeerrSites').value, outcome === 'success' ? 'home' : 'family');
  assert.equal(f.manager.connectionId, outcome === 'success' ? 'home' : 'family');
  assert.equal(f.doc.getElementById('apiKey').value, outcome === 'success' ? 'home-key' : 'unsaved-family-key');
  assert.equal(f.doc.getElementById('savedSeerrSites').disabled, false);
});

test('saved-site actions wait for the latest site-list refresh', async t => {
  const f = await fixture(t);
  let release;
  f.window.chrome.runtime.sendMessage = () => new Promise(resolve => { release = resolve; });
  const refresh = f.manager.loadConnectionChoices();
  assert.equal(f.doc.getElementById('useSeerrSite').disabled, true);
  assert.equal(f.doc.getElementById('removeSeerrSite').disabled, true);
  let calls = 0;
  f.window.chrome.runtime.sendMessage = async () => { calls++; return f.reply(); };
  await f.manager.useConnection(); await f.manager.removeConnection();
  assert.equal(calls, 0);
  release(f.reply()); await refresh;
  assert.equal(f.doc.getElementById('useSeerrSite').disabled, false);
  assert.equal(f.doc.getElementById('removeSeerrSite').disabled, false);
  assert.equal(f.doc.getElementById('apiKey').value, 'unsaved-family-key');
});

test('failed site selection restores a removed previous site as an unsaved draft', async t => {
  const f = await fixture(t);
  let reject;
  f.window.chrome.storage.local.get = () => new Promise((_, fail) => { reject = fail; });
  f.doc.getElementById('savedSeerrSites').value = 'home';
  const editing = f.manager.editConnection();
  const data = f.reply().data;
  f.window.chrome.runtime.sendMessage = async () => ({ success: true, data: { ...data, sites: data.sites.filter(site => site.id !== 'family') } });
  await f.manager.loadConnectionChoices();
  reject(new Error('Storage unavailable')); await editing;
  assert.equal(f.doc.getElementById('savedSeerrSites').value, 'family');
  assert.equal(f.doc.getElementById('savedSeerrSites').selectedOptions[0].textContent, 'Removed site (unsaved edits)');
  assert.equal(f.doc.getElementById('apiKey').value, 'unsaved-family-key');
  assert.equal(f.doc.getElementById('useSeerrSite').disabled, true);
  assert.equal(f.doc.getElementById('removeSeerrSite').disabled, true);
});

for (const action of ['useConnection', 'removeConnection']) {
  test(`${action} reports a committed change separately from failed settings reload`, async t => {
    const f = await fixture(t);
    const original = f.reply().data;
    const committed = action === 'useConnection'
      ? { ...original, revision: 2, activeId: 'family' }
      : { ...original, revision: 2, sites: original.sites.filter(site => site.id !== 'family') };
    let mutations = 0;
    f.window.chrome.runtime.sendMessage = async message => {
      if (message.action !== 'getSeerrConnections') mutations++;
      return { success: true, data: committed };
    };
    f.window.chrome.storage.local.get = async () => { throw new Error('Temporary read failure'); };
    await f.manager[action]();
    assert.equal(mutations, 1, 'a failed refresh must not resend the completed mutation');
    const status = f.doc.getElementById('status');
    assert.ok(status.classList.contains('error'));
    assert.match(status.textContent, action === 'useConnection' ? /Site switched/ : /Saved site removed/);
    assert.match(status.textContent, /settings could not be loaded.*Reload this Settings page/i);
    assert.equal(f.doc.getElementById('apiKey').value, 'unsaved-family-key', 'the failed read must preserve the draft');
    assert.equal(f.manager.connectionChoices.activeId, committed.activeId);
    assert.equal(f.doc.getElementById('useSeerrSite').disabled, true);
    assert.equal(f.doc.getElementById('removeSeerrSite').disabled, true);
  });
}

for (const settingsActive of ['home', 'family']) test(`a concurrent site switch reports the latest active site (settings snapshot: ${settingsActive})`, async t => {
  const f = await fixture(t);
  const original = f.reply().data;
  const committed = { ...original, revision: 2, activeId: 'family' };
  const latest = { ...original, revision: 3, activeId: 'home' };
  f.window.chrome.runtime.sendMessage = async message => ({ success: true,
    data: message.action === 'activateSeerrConnection' ? committed : latest });
  f.window.chrome.storage.local.get = async () => ({ seerrConnectionsV1: { ...latest, activeId: settingsActive } });
  await f.manager.useConnection();
  const status = f.doc.getElementById('status');
  assert.ok(status.classList.contains('info'));
  assert.match(status.textContent, /active site changed again/i);
  assert.match(status.textContent, /Now using Home/);
  assert.doesNotMatch(status.textContent, /Now using Family/);
  assert.match(f.doc.getElementById('activeSeerrSite').textContent, /Active site: Home/);
  assert.equal(f.doc.getElementById('apiKey').value, `${settingsActive}-key`);
});

test('a failed legacy fallback read cannot relabel the previous draft as another site', async t => {
  const f = await fixture(t);
  f.doc.getElementById('savedSeerrSites').value = 'home';
  f.window.chrome.storage.local.get = async keys => {
    if (typeof keys === 'string') return {};
    throw new Error('Temporary settings read failure');
  };
  await f.manager.editConnection();
  assert.equal(f.manager.connectionId, 'family');
  assert.equal(f.doc.getElementById('savedSeerrSites').value, 'family');
  assert.equal(f.doc.getElementById('apiKey').value, 'unsaved-family-key');
  assert.match(f.doc.getElementById('status').textContent, /Could not load this site/);
});

for (const outcome of ['success', 'failure']) test(`site selection protects editable settings until the delayed read ${outcome}`, async t => {
  const f = await fixture(t);
  const localGet = f.window.chrome.storage.local.get;
  const inputs = [...f.doc.querySelectorAll('#settingsForm input')];
  // An independently disabled setting must remain disabled after the lock.
  const alreadyDisabled = f.doc.getElementById('debugLogging');
  alreadyDisabled.disabled = true;
  let resolve, reject;
  f.window.chrome.storage.local.get = () => new Promise((a, b) => { resolve = a; reject = b; });
  f.doc.getElementById('savedSeerrSites').value = 'home';
  const editing = f.manager.editConnection();
  assert.ok(inputs.every(input => input.disabled), 'no field can accept edits that the pending read would erase');
  assert.equal(f.doc.querySelector('button[type=submit]').disabled, true);
  assert.equal(f.doc.getElementById('settingsForm').getAttribute('aria-busy'), 'true');
  await f.manager.loadConnectionChoices();
  assert.ok(inputs.every(input => input.disabled), 'metadata refresh keeps the edit lock');
  if (outcome === 'success') resolve(await localGet());
  else reject(new Error('Storage unavailable'));
  await editing;
  assert.ok(inputs.filter(input => input !== alreadyDisabled).every(input => !input.disabled));
  assert.equal(alreadyDisabled.disabled, true);
  assert.equal(f.doc.querySelector('button[type=submit]').disabled, false);
  assert.equal(f.doc.getElementById('settingsForm').getAttribute('aria-busy'), 'false');
  assert.equal(f.doc.getElementById('apiKey').value, outcome === 'success' ? 'home-key' : 'unsaved-family-key');
});

for (const action of ['useConnection', 'removeConnection']) test(`${action} locks fields through its saved-settings read`, async t => {
  const f = await fixture(t);
  const profiles = f.reply().data;
  const committed = action === 'useConnection'
    ? { ...profiles, activeId: 'family' }
    : { ...profiles, sites: profiles.sites.filter(site => site.id !== 'family') };
  f.window.chrome.runtime.sendMessage = async () => ({ success: true, data: committed });
  let finishRead;
  f.window.chrome.storage.local.get = () => new Promise(resolve => {
    finishRead = () => {
      f.window.chrome.storage.local.get = async () => ({ seerrConnectionsV1: committed });
      resolve({ seerrConnectionsV1: committed });
    };
  });
  const operation = f.manager[action]();
  await settle();
  assert.equal(typeof finishRead, 'function');
  assert.ok([...f.doc.querySelectorAll('#settingsForm input')].every(input => input.disabled));
  assert.equal(f.doc.querySelector('button[type=submit]').disabled, true);
  finishRead(); await operation;
  assert.ok([...f.doc.querySelectorAll('#settingsForm input')].every(input => !input.disabled));
  assert.equal(f.doc.querySelector('button[type=submit]').disabled, false);
  assert.equal(f.doc.getElementById('apiKey').value, action === 'useConnection' ? 'family-key' : 'home-key');
});

for (const outcome of ['success', 'failure']) for (const timing of ['during read', 'after read']) {
  test(`site selection replaces obsolete connection-test ${outcome} (${timing})`, async t => {
    const f = await fixture(t);
    let finishTest;
    f.window.chrome.runtime.sendMessage = message => message.action === 'testConnection'
      ? new Promise(resolve => { finishTest = resolve; }) : Promise.resolve(f.reply());
    const testing = f.manager.testConnection();
    await settle();
    assert.equal(typeof finishTest, 'function');
    const get = f.window.chrome.storage.local.get;
    let finishRead;
    f.window.chrome.storage.local.get = () => new Promise(resolve => { finishRead = resolve; });
    f.doc.getElementById('savedSeerrSites').value = 'home';
    const editing = f.manager.editConnection();
    assert.match(f.doc.getElementById('status').textContent, /Loading saved site/);
    const reply = outcome === 'success' ? { success: true, data: { user: 'Old family account' } }
      : { success: false, error: 'Old family failure' };
    if (timing === 'during read') {
      finishTest(reply); await testing;
      assert.match(f.doc.getElementById('status').textContent, /Loading saved site/);
    }
    finishRead(await get()); await editing;
    if (timing === 'after read') { finishTest(reply); await testing; }
    assert.equal(f.doc.getElementById('serverUrl').value, 'https://home.example/');
    assert.match(f.doc.getElementById('status').textContent, /Saved site loaded/);
    assert.doesNotMatch(f.doc.getElementById('status').textContent, /Old family|Connected as|Settings changed during/);
    assert.equal(f.doc.getElementById('testConnection').disabled, false);
  });
}

for (const outcome of ['success', 'failure']) test(`connection tests wait for a saved-site read (${outcome})`, async t => {
  const f = await fixture(t);
  f.doc.getElementById('plexToken').value = 'plex-token';
  const get = f.window.chrome.storage.local.get;
  let finish, fail;
  f.window.chrome.storage.local.get = () => new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  f.doc.getElementById('savedSeerrSites').value = 'home';
  const editing = f.manager.editConnection();
  assert.equal(f.doc.getElementById('testConnection').disabled, true);
  assert.equal(f.doc.getElementById('testPlexConnection').disabled, true);
  const before = f.messages.length;
  await f.manager.testConnection(); await f.manager.testPlexConnection();
  assert.equal(f.messages.length, before, 'the old form values cannot start a test');
  assert.match(f.doc.getElementById('status').textContent, /Loading saved site/);
  if (outcome === 'success') finish(await get());
  else fail(new Error('Read unavailable'));
  await editing;
  assert.equal(f.doc.getElementById('testConnection').disabled, false);
  assert.equal(f.doc.getElementById('testPlexConnection').disabled, false);
});

for (const [method, action, buttonId] of [
  ['testConnection', 'testConnection', 'testConnection'],
  ['testPlexConnection', 'plexTestConnection', 'testPlexConnection']
]) for (const timing of ['during read', 'after read']) {
  test(`${action} retains its lock through metadata refresh and completion ${timing}`, async t => {
    const f = await fixture(t);
    f.doc.getElementById('plexToken').value = 'plex-token';
    let finishTest;
    f.window.chrome.runtime.sendMessage = message => message.action === action
      ? new Promise(resolve => { finishTest = resolve; }) : Promise.resolve(f.reply());
    const testing = f.manager[method]();
    await settle();
    await f.manager.loadConnectionChoices();
    const button = f.doc.getElementById(buttonId);
    assert.equal(button.disabled, true, 'a metadata refresh cannot unlock the pending test');
    const get = f.window.chrome.storage.local.get;
    let finishRead;
    f.window.chrome.storage.local.get = () => new Promise(resolve => { finishRead = resolve; });
    f.doc.getElementById('savedSeerrSites').value = 'home';
    const editing = f.manager.editConnection();
    if (timing === 'during read') {
      finishTest({ success: true, data: { user: 'Old account' } }); await testing;
      assert.equal(button.disabled, true, 'test completion cannot unlock a pending site read');
    }
    finishRead(await get()); await editing;
    if (timing === 'after read') {
      assert.equal(button.disabled, true, 'site-read completion cannot unlock a pending test');
      finishTest({ success: true, data: { user: 'Old account' } }); await testing;
    }
    assert.equal(button.disabled, false);
  });
}

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

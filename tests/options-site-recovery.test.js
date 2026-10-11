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

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const tick = () => new Promise(resolve => setImmediate(resolve));
const data = { revision: 1, activeId: 'home', sites: [
  { id: 'home', name: 'Home', url: 'https://home.example' },
  { id: 'family', name: 'Family', url: 'https://family.example' }
] };
async function fixture(t, send) {
  const dom = new JSDOM(fs.readFileSync('src/popup/popup.html', 'utf8'), { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  let changed;
  dom.window.chrome = { runtime: { sendMessage: send },
    storage: { onChanged: { addListener: callback => { changed = callback; } } },
    permissions: { request: async () => { throw new Error('Unexpected switch'); } } };
  dom.window.eval(fs.readFileSync('src/popup/connections.js', 'utf8'));
  await tick();
  return { window: dom.window, doc: dom.window.document, changed };
}
for (const failure of ['rejected', 'missing', 'malformed', 'throw']) test(`popup can retry a ${failure} site-list reply`, async t => {
  const f = await fixture(t, async () => {
    if (failure === 'throw') throw new Error('Disconnected');
    return failure === 'missing' ? undefined : failure === 'rejected' ? { success: false } : { success: true, data: {} };
  });
  const select = f.doc.getElementById('activeSeerrSite'), retry = f.doc.getElementById('retrySeerrSites');
  assert.equal(select.disabled, true); assert.equal(retry.classList.contains('hidden'), false);
  assert.equal(retry.disabled, false);
  let release;
  f.window.chrome.runtime.sendMessage = () => new Promise(resolve => { release = resolve; });
  retry.focus(); retry.click();
  assert.equal(retry.disabled, true);
  release({ success: true, data }); await tick();
  assert.equal(select.value, 'home'); assert.equal(select.disabled, false);
  assert.equal(retry.classList.contains('hidden'), true);
  assert.equal(f.doc.activeElement, select);
  assert.equal(f.doc.getElementById('siteSwitchStatus').textContent, '');
});

test('a pending popup list refresh blocks stale selector actions until the latest reply', async t => {
  const f = await fixture(t, async () => ({ success: true, data }));
  const select = f.doc.getElementById('activeSeerrSite');
  let releaseOld, releaseNew, calls = 0;
  f.window.chrome.runtime.sendMessage = () => { calls++; return new Promise(resolve => {
    if (calls === 1) releaseOld = resolve; else releaseNew = resolve;
  }); };
  f.changed({ seerrConnectionsV1: {} }, 'local');
  assert.equal(select.disabled, true);
  select.value = 'family'; select.dispatchEvent(new f.window.Event('change'));
  assert.equal(calls, 1, 'stale selection cannot send a mutation');
  f.changed({ seerrConnectionsV1: {} }, 'local');
  releaseOld({ success: true, data }); await tick();
  assert.equal(select.disabled, true);
  assert.equal(f.doc.getElementById('retrySeerrSites').disabled, true);
  releaseNew({ success: true, data: { ...data, revision: 2, activeId: 'family' } }); await tick();
  assert.equal(select.disabled, false); assert.equal(select.value, 'family');
});

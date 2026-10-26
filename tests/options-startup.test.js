const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };

function fixture(t, localGet) {
  const dom = new JSDOM(fs.readFileSync('src/options/options.html', 'utf8'), {
    url: 'https://extension.example/options#apiKey', runScripts: 'outside-only'
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  const writes = [];
  window.chrome = {
    storage: { onChanged: { addListener() {} },
      sync: { get: async () => ({ seerrUrl: 'https://home.example/' }), set: async value => writes.push(value) },
      local: { get: localGet, set: async value => writes.push(value) } },
    permissions: { contains: async () => true, request: async () => true },
    runtime: { sendMessage: async () => ({ success: true, data: { sites: [], activeId: null } }) }
  };
  window.eval(fs.readFileSync('src/options/options.js', 'utf8').split('// Initialize when DOM is loaded')[0] +
    '\nwindow.manager = new OptionsManager();');
  return { window, doc: window.document, writes };
}

for (const outcome of ['success', 'failure']) test(`initial saved-settings ${outcome} protects the form and then restores it`, async t => {
  let resolve, reject;
  const f = fixture(t, () => new Promise((a, b) => { resolve = a; reject = b; }));
  const form = f.doc.getElementById('settingsForm');
  assert.ok([...form.querySelectorAll('input')].every(input => input.disabled), 'startup cannot accept edits the saved values will erase');
  assert.equal(form.querySelector('button[type=submit]').disabled, true);
  assert.equal(form.getAttribute('aria-busy'), 'true');
  const submit = new f.window.Event('submit', { bubbles: true, cancelable: true });
  form.dispatchEvent(submit);
  assert.equal(submit.defaultPrevented, true, 'a pending startup cannot trigger native form navigation');
  assert.equal(f.writes.length, 0);
  f.window.chrome.storage.local.get = async () => ({ seerrApiKey: 'home-key' });
  if (outcome === 'success') resolve({ seerrApiKey: 'home-key' });
  else reject(new Error('Initial read failed'));
  await settle();
  assert.ok([...form.querySelectorAll('input')].every(input => !input.disabled));
  assert.equal(form.querySelector('button[type=submit]').disabled, false);
  assert.equal(form.getAttribute('aria-busy'), 'false');
  if (outcome === 'success') {
    assert.equal(f.doc.getElementById('serverUrl').value, 'https://home.example/');
    assert.equal(f.doc.getElementById('apiKey').value, 'home-key');
  } else assert.match(f.doc.getElementById('status').textContent, /Failed to load settings/);
  assert.equal(f.doc.activeElement.id, 'apiKey', 'popup repair focus runs after startup unlocks the form');
});

test('a failed startup permission read does not skip cache count or popup repair focus', async t => {
  const f = fixture(t, async keys => {
    if (keys === 'seerrConnectionsV1') throw new Error('Temporary permission-state read failure');
    return { seerrApiKey: 'home-key' };
  });
  await settle();
  assert.equal(f.doc.getElementById('ratingsCacheCount').textContent, 'No ratings cached');
  assert.equal(f.doc.activeElement.id, 'apiKey');
  assert.equal(f.doc.getElementById('apiKey').disabled, false);
});

test('a malformed saved site profile fails closed instead of restoring legacy settings', async t => {
  const malformed = { revision: 4, activeId: 'broken', sites: [{ id: 'broken', url: 'javascript:alert(1)', apiKey: 'unsafe-secret' }] };
  const f = fixture(t, async () => ({ seerrConnectionsV1: malformed, seerrApiKey: 'legacy-secret' }));
  await settle();
  assert.equal(f.doc.getElementById('serverUrl').value, '');
  assert.equal(f.doc.getElementById('apiKey').value, '');
  assert.equal(f.doc.getElementById('permissionWarning').classList.contains('hidden'), true);
});

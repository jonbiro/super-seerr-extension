// The options page owns the decision made when a host permission is declined:
// settings still save, and a standing notice offers to retry.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };

function openOptions({ granted = true, synced = {}, local = {} } = {}) {
  const html = fs.readFileSync('src/options/options.html', 'utf8');
  const dom = new JSDOM(html, { url: 'chrome-extension://test/options.html', runScripts: 'outside-only' });
  const { window } = dom;
  const syncWrites = [];
  const localWrites = [];
  const requested = [];
  const order = [];

  window.chrome = {
    storage: {
      sync: {
        get: async () => ({ ...synced }),
        set: async value => { order.push('sync.set'); syncWrites.push(value); }
      },
      local: {
        get: async () => ({ ...local }),
        set: async value => { order.push('local.set'); localWrites.push(value); }
      }
    },
    permissions: {
      contains: async () => granted,
      request: async ({ origins }) => { order.push('permissions.request'); requested.push(...origins); return granted; }
    },
    runtime: { sendMessage: async () => ({ success: true }) }
  };
  window.eval(fs.readFileSync('src/options/options.js', 'utf8'));
  return { dom, window, syncWrites, localWrites, requested, order };
}

const warningHidden = window => window.document.getElementById('permissionWarning').classList.contains('hidden');

test('a saved server with no permission shows the standing notice', async t => {
  const ctx = openOptions({ granted: false, synced: { seerrUrl: 'https://seerr.example' } });
  t.after(() => ctx.dom.window.close());
  await flush();
  assert.equal(warningHidden(ctx.window), false, 'the notice should be visible');
});

test('a granted permission leaves the notice hidden', async t => {
  const ctx = openOptions({ granted: true, synced: { seerrUrl: 'https://seerr.example' } });
  t.after(() => ctx.dom.window.close());
  await flush();
  assert.equal(warningHidden(ctx.window), true);
});

test('with no server saved there is nothing to warn about', async t => {
  const ctx = openOptions({ granted: false, synced: {} });
  t.after(() => ctx.dom.window.close());
  await flush();
  assert.equal(warningHidden(ctx.window), true);
});

test('declining the permission still saves the settings', async t => {
  const ctx = openOptions({ granted: false });
  t.after(() => ctx.dom.window.close());
  await flush();

  ctx.window.document.getElementById('serverUrl').value = 'https://seerr.example:5055';
  ctx.window.document.getElementById('apiKey').value = 'secret-key';
  ctx.window.document.getElementById('settingsForm').dispatchEvent(new ctx.window.Event('submit'));
  await flush();

  assert.equal(ctx.syncWrites.length, 1, 'the URL must still be saved');
  assert.equal(ctx.syncWrites[0].seerrUrl, 'https://seerr.example:5055');
  assert.equal(ctx.localWrites[0].seerrApiKey, 'secret-key', 'the key must still be saved');
  assert.equal(warningHidden(ctx.window), false, 'and the notice must appear');
});

test('the permission is requested before anything is written, and without a port', async t => {
  const ctx = openOptions({ granted: true });
  t.after(() => ctx.dom.window.close());
  await flush();

  ctx.window.document.getElementById('serverUrl').value = 'http://localhost:5055/';
  ctx.window.document.getElementById('settingsForm').dispatchEvent(new ctx.window.Event('submit'));
  await flush();

  // Chrome rejects permissions.request() once the user gesture is gone, so it
  // must come first — before any storage await.
  assert.equal(ctx.order[0], 'permissions.request', `expected request first, saw ${ctx.order.join(' -> ')}`);
  assert.deepEqual(ctx.requested, ['http://localhost/*'], 'match patterns cannot carry a port');
});

test('the API key and the verbose logging flag are written to local, never sync', async t => {
  const ctx = openOptions({ granted: true });
  t.after(() => ctx.dom.window.close());
  await flush();

  ctx.window.document.getElementById('serverUrl').value = 'https://seerr.example';
  ctx.window.document.getElementById('apiKey').value = 'secret-key';
  ctx.window.document.getElementById('debugLogging').checked = true;
  ctx.window.document.getElementById('settingsForm').dispatchEvent(new ctx.window.Event('submit'));
  await flush();

  assert.equal(ctx.localWrites[0].seerrApiKey, 'secret-key');
  assert.equal(ctx.localWrites[0].debugLogging, true);
  assert.ok(!('seerrApiKey' in ctx.syncWrites[0]), 'the key must never reach synced storage');
  assert.ok('overlayFeatures' in ctx.syncWrites[0], 'preferences still sync');
});

test('an invalid URL is rejected before any permission prompt or write', async t => {
  const ctx = openOptions({ granted: true });
  t.after(() => ctx.dom.window.close());
  await flush();

  for (const value of ['', 'not a url', 'ftp://seerr.example', 'https://user:pw@seerr.example', 'https://seerr.example?x=1']) {
    ctx.window.document.getElementById('serverUrl').value = value;
    ctx.window.document.getElementById('settingsForm').dispatchEvent(new ctx.window.Event('submit'));
    await flush();
  }
  assert.equal(ctx.order.length, 0, `nothing should happen for invalid URLs, saw ${ctx.order.join(' -> ')}`);
});

test('the saved key is loaded back from local storage into the form', async t => {
  const ctx = openOptions({ granted: true, synced: { seerrUrl: 'https://seerr.example' }, local: { seerrApiKey: 'stored-key', debugLogging: true } });
  t.after(() => ctx.dom.window.close());
  await flush();

  assert.equal(ctx.window.document.getElementById('apiKey').value, 'stored-key');
  assert.equal(ctx.window.document.getElementById('debugLogging').checked, true);
});

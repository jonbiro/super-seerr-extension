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
  const localRemovals = [];
  const requested = [];
  const order = [];

  // Mutable stores: a read after a write must see the write, or a test can
  // pass against a page that never actually changed anything.
  const syncStore = { ...synced };
  const localStore = { ...local };
  window.chrome = {
    storage: {
      sync: {
        get: async () => ({ ...syncStore }),
        set: async value => { order.push('sync.set'); syncWrites.push(value); Object.assign(syncStore, value); }
      },
      local: {
        get: async () => ({ ...localStore }),
        set: async value => { order.push('local.set'); localWrites.push(value); Object.assign(localStore, value); },
        remove: async keys => {
          order.push('local.remove');
          localRemovals.push(keys);
          (Array.isArray(keys) ? keys : [keys]).forEach(key => delete localStore[key]);
        }
      }
    },
    permissions: {
      contains: async () => granted,
      request: async ({ origins }) => { order.push('permissions.request'); requested.push(...origins); return granted; }
    },
    runtime: { sendMessage: async () => ({ success: true }) }
  };
  window.eval(fs.readFileSync('src/options/options.js', 'utf8'));
  return { dom, window, syncWrites, localWrites, localRemovals, requested, order };
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

test('Settings reports how many ratings are cached and clears them', async t => {
  const ctx = openOptions({
    granted: true,
    local: { overlayRatingsV1: { server: 'https://seerr.example/', entries: { 'movie:550': {}, 'tv:1396': {} } } }
  });
  t.after(() => ctx.dom.window.close());
  await flush();

  assert.match(ctx.window.document.getElementById('ratingsCacheCount').textContent, /2 titles cached/);
  assert.equal(ctx.window.document.getElementById('clearRatingsCache').disabled, false);

  ctx.window.document.getElementById('clearRatingsCache').click();
  await flush();

  // Removal, not an empty write: open tabs treat a write as a normal flush.
  // Flatten: the arrays come from the page realm.
  assert.deepEqual(ctx.localRemovals.map(keys => [...keys]), [['overlayRatingsV1']]);
  assert.match(ctx.window.document.getElementById('ratingsCacheCount').textContent, /No ratings cached/);
  assert.equal(ctx.window.document.getElementById('clearRatingsCache').disabled, true, 'nothing left to clear');
});

test('an empty or missing ratings cache disables the clear button', async t => {
  for (const local of [{}, { overlayRatingsV1: { server: 'x', entries: {} } }, { overlayRatingsV1: 'corrupt' }]) {
    const ctx = openOptions({ granted: true, local });
    t.after(() => ctx.dom.window.close());
    await flush();
    assert.match(ctx.window.document.getElementById('ratingsCacheCount').textContent, /No ratings cached/);
    assert.equal(ctx.window.document.getElementById('clearRatingsCache').disabled, true);
  }
});

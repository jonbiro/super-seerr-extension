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
    runtime: { sendMessage: async message => {
      if (message.action === 'clearRatingsCache') {
        await window.chrome.storage.local.remove(['rtCacheV1', 'seerrRatingsUnavailableV1', 'overlayRatingsV1']);
      }
      return { success: true };
    } }
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
  // The record of endpoints this server does not serve goes with the cache:
  // clearing is the user saying "try again", which includes those.
  assert.deepEqual(ctx.localRemovals.map(keys => [...keys]), [['rtCacheV1', 'seerrRatingsUnavailableV1', 'overlayRatingsV1']]);
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

test('the permission notice comes before the form, not after the buttons', async t => {
  // It explains why the overlay is not running, so burying it below the
  // action buttons put the page's most important message below the fold.
  const ctx = openOptions({ granted: false, synced: { seerrUrl: 'https://seerr.example' } });
  t.after(() => ctx.dom.window.close());
  await flush();

  const { document } = ctx.window;
  const notice = document.getElementById('permissionWarning');
  const form = document.getElementById('settingsForm');
  assert.ok(notice && form);

  const order = notice.compareDocumentPosition(form);
  assert.ok(order & ctx.window.Node.DOCUMENT_POSITION_FOLLOWING,
    'the notice should precede the form');
});

test('action labels do not break across lines', () => {
  const css = require('node:fs').readFileSync('src/options/options.css', 'utf8');
  const rule = css.slice(css.indexOf('.button {'), css.indexOf('}', css.indexOf('.button {')));
  assert.match(rule, /white-space:\s*nowrap/, 'two-word labels were wrapping inside the button');
});

test('settings offers no vestigial skip action', () => {
  // "Skip for now" only closed the window, and dated from when this page
  // opened itself on install. That flow is gone, so the control asked the
  // reader to skip something that was never being presented.
  const html = require('node:fs').readFileSync('src/options/options.html', 'utf8');
  const script = require('node:fs').readFileSync('src/options/options.js', 'utf8');
  assert.ok(!html.includes('skipSetup'), 'no skip control in the markup');
  assert.ok(!script.includes('skipButton'), 'and nothing left wiring it');
});

test('double submissions save once and prompt once', async t => {
  // The second prompt would arrive with no user gesture left, so it could
  // neither be granted nor declined — only hang or fail behind the real save.
  const ctx = openOptions({ granted: true });
  t.after(() => ctx.dom.window.close());
  await flush();

  ctx.window.document.getElementById('serverUrl').value = 'https://seerr.example';
  const form = ctx.window.document.getElementById('settingsForm');
  form.dispatchEvent(new ctx.window.Event('submit'));
  form.dispatchEvent(new ctx.window.Event('submit'));
  await flush();

  assert.equal(ctx.syncWrites.length, 1, 'one save, not two');
  assert.equal(ctx.order.filter(entry => entry === 'permissions.request').length, 1, 'one prompt, not two');
});

test('Test Plex requests host access before contacting the worker without saving', async t => {
  const ctx = openOptions(); t.after(() => ctx.window.close());
  await flush();
  const events = [];
  ctx.window.chrome.permissions.request = async ({ origins }) => {
    events.push('permission');
    assert.ok(origins.includes('https://plex.tv/*'));
    return true;
  };
  ctx.window.chrome.runtime.sendMessage = async message => {
    events.push(message.action);
    return { success: true, data: { user: 'Test account' } };
  };
  ctx.window.document.getElementById('plexToken').value = 'test-token';
  ctx.window.document.getElementById('testPlexConnection').click();
  await flush();
  assert.deepEqual(events, ['permission', 'plexTestConnection']);
  assert.equal(ctx.localWrites.length, 0);
});

test('Test Plex stops when host access is declined', async t => {
  const ctx = openOptions({ granted: false }); t.after(() => ctx.window.close());
  await flush();
  let messages = 0;
  ctx.window.chrome.runtime.sendMessage = async () => { messages++; return { success: true }; };
  ctx.window.document.getElementById('plexToken').value = 'test-token';
  ctx.window.document.getElementById('testPlexConnection').click();
  await flush();
  assert.equal(messages, 0);
  assert.match(ctx.window.document.getElementById('status').textContent, /permission/i);
  assert.equal(ctx.window.document.getElementById('testPlexConnection').disabled, false);
});

test('saving Seerr and Plex permissions uses one user-gesture request', async t => {
  const ctx = openOptions(); t.after(() => ctx.window.close());
  await flush();
  const requests = [];
  ctx.window.chrome.permissions.request = async ({ origins }) => { requests.push([...origins]); return true; };
  ctx.window.document.getElementById('serverUrl').value = 'https://seerr.example';
  ctx.window.document.getElementById('plexToken').value = 'test-token';
  ctx.window.document.getElementById('settingsForm').dispatchEvent(new ctx.window.Event('submit'));
  await flush();
  assert.equal(requests.length, 1, 'a second asynchronous permission prompt can lose the click gesture');
  assert.deepEqual(new Set(requests[0]), new Set(['https://seerr.example/*', 'https://plex.tv/*', 'https://*.plex.tv/*']));
});

test('granting the standing warning targets the saved server despite unsaved edits', async t => {
  const ctx = openOptions({ granted: false, synced: { seerrUrl: 'https://saved.example:5055' } });
  t.after(() => ctx.window.close()); await flush();
  ctx.window.document.getElementById('serverUrl').value = 'https://unsaved.example';
  ctx.window.document.getElementById('grantPermission').click();
  assert.deepEqual(ctx.requested, ['https://saved.example/*'], 'request remains synchronous with the click');
  await flush(); assert.equal(ctx.syncWrites.length, 0);
});

test('cache read failures remain unknown and clearing stays available without duplicate requests', async t => {
  const ctx = openOptions({ local: { rtCacheV1: { entries: { film: {} } } } });
  t.after(() => ctx.window.close()); await flush();
  let finish, calls = 0;
  ctx.window.chrome.storage.local.get = async () => { throw new Error('Storage unavailable'); };
  ctx.window.chrome.runtime.sendMessage = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const button = ctx.window.document.getElementById('clearRatingsCache');
  button.click(); button.click();
  assert.equal(calls, 1); assert.equal(button.disabled, true); assert.match(button.textContent, /Clearing/);
  finish({ success: false }); await flush();
  assert.match(ctx.window.document.getElementById('ratingsCacheCount').textContent, /Could not read/);
  assert.equal(button.disabled, false);
  button.click(); assert.equal(calls, 2);
  finish({ success: true }); await flush();
  assert.equal(button.disabled, false);
});

for (const target of ['Seerr', 'Plex']) {
  test(`${target} test cannot claim success for edited settings`, async t => {
    const ctx = openOptions({ synced: { seerrUrl: 'https://saved.example' }, local: { seerrApiKey: 'old-key', plexToken: 'old-token' } });
    t.after(() => ctx.window.close()); await flush();
    let complete;
    ctx.window.chrome.runtime.sendMessage = () => new Promise(resolve => { complete = resolve; });
    const doc = ctx.window.document;
    const button = doc.getElementById(target === 'Seerr' ? 'testConnection' : 'testPlexConnection');
    button.click(); await flush();
    doc.getElementById(target === 'Seerr' ? 'apiKey' : 'plexToken').value = 'edited-value';
    complete({ success: true, data: { user: 'Old account' } }); await flush();
    assert.match(doc.getElementById('status').textContent, /Settings changed.*Test again/);
    assert.doesNotMatch(doc.getElementById('status').textContent, /Old account/);
    assert.equal(button.disabled, false);
  });
}

test('an older connection failure cannot overwrite a newer test result', async t => {
  const ctx = openOptions({ synced: { seerrUrl: 'https://saved.example' }, local: { seerrApiKey: 'key', plexToken: 'token' } });
  t.after(() => ctx.window.close()); await flush();
  const pending = {};
  ctx.window.chrome.runtime.sendMessage = ({ action }) => new Promise((resolve, reject) => { pending[action] = { resolve, reject }; });
  const doc = ctx.window.document;
  doc.getElementById('testConnection').click();
  doc.getElementById('testPlexConnection').click(); await flush();
  pending.plexTestConnection.resolve({ success: true, data: { user: 'New account' } }); await flush();
  pending.testConnection.reject(new Error('Old failure')); await flush();
  assert.match(doc.getElementById('status').textContent, /Plex connected as New account/);
  assert.equal(doc.getElementById('testConnection').disabled, false);
});

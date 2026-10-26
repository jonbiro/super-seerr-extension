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
  const storageListeners = [];

  // Mutable stores: a read after a write must see the write, or a test can
  // pass against a page that never actually changed anything.
  const syncStore = { ...synced };
  const localStore = { ...local };
  window.chrome = {
    storage: {
      onChanged: { addListener: listener => storageListeners.push(listener) },
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
        await window.chrome.storage.local.remove(['rtCacheV1', 'seerrRatingsUnavailableV1', 'overlayRatingsV1', 'overlayRatingsByServerV1']);
      }
      return { success: true };
    } }
  };
  window.eval(fs.readFileSync('src/options/options.js', 'utf8'));
  return { dom, window, syncWrites, localWrites, localRemovals, requested, order, storageListeners };
}

const warningHidden = window => window.document.getElementById('permissionWarning').classList.contains('hidden');

test('Settings updates its count and clear button when another tab changes shared or site caches', async t => {
  const ctx = openOptions(); t.after(() => ctx.dom.window.close()); await flush();
  const count = ctx.window.document.getElementById('ratingsCacheCount');
  const clear = ctx.window.document.getElementById('clearRatingsCache');
  const snapshots = [
    { publicRatingsV1: { entries: { 'movie:1': {} } } },
    { overlayRatingsByServerV1: { first: { entries: { 'movie:1': {} } }, second: { entries: { 'movie:1': {} } } } },
    {}
  ];
  for (const [i, key] of ['publicRatingsV1', 'overlayRatingsByServerV1', 'ratingsCacheEpoch'].entries()) {
    ctx.window.chrome.storage.local.get = async () => snapshots[i];
    for (const listener of ctx.storageListeners) listener({ [key]: { newValue: snapshots[i][key] } }, 'local');
    await flush();
    assert.equal(count.textContent, i === 2 ? 'No ratings cached' : `${i + 1} cache entr${i ? 'ies' : 'y'}`);
    assert.equal(clear.disabled, i === 2);
  }
});

test('an older count read cannot restore pre-clear Settings state', async t => {
  const ctx = openOptions(); t.after(() => ctx.dom.window.close()); await flush();
  const reads = [];
  ctx.window.chrome.storage.local.get = () => new Promise(resolve => reads.push(resolve));
  for (const key of ['publicRatingsV1', 'ratingsCacheEpoch']) {
    for (const listener of ctx.storageListeners) listener({ [key]: {} }, 'local');
  }
  assert.equal(reads.length, 2);
  reads[1]({}); await flush();
  reads[0]({ publicRatingsV1: { entries: { 'movie:1': {} } } }); await flush();
  assert.equal(ctx.window.document.getElementById('ratingsCacheCount').textContent, 'No ratings cached');
  assert.equal(ctx.window.document.getElementById('clearRatingsCache').disabled, true);
});

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

test('a malformed legacy URL does not discard local settings or crash Settings', async t => {
  const ctx = openOptions({
    granted: true,
    synced: { seerrUrl: 'javascript:alert(1)', overlayFeatures: { cardBadges: false } },
    local: { seerrApiKey: 'stored-key', plexToken: 'plex-token', debugLogging: true }
  });
  t.after(() => ctx.dom.window.close());
  await flush();

  assert.equal(ctx.window.document.getElementById('serverUrl').value, '');
  assert.equal(ctx.window.document.getElementById('apiKey').value, 'stored-key');
  assert.equal(ctx.window.document.getElementById('plexToken').value, 'plex-token');
  assert.equal(ctx.window.document.getElementById('debugLogging').checked, true);
  assert.equal(ctx.window.document.querySelector('[data-overlay-feature="cardBadges"]').checked, false);
  assert.match(ctx.window.document.getElementById('status').textContent, /saved Seerr URL is invalid/i);
});

test('Settings reports how many ratings are cached and clears them', async t => {
  const ctx = openOptions({
    granted: true,
    local: { overlayRatingsV1: { server: 'https://seerr.example/', entries: { 'movie:550': {}, 'tv:1396': {} } } }
  });
  t.after(() => ctx.dom.window.close());
  await flush();

  assert.match(ctx.window.document.getElementById('ratingsCacheCount').textContent, /2 cache entries/);
  assert.equal(ctx.window.document.getElementById('clearRatingsCache').disabled, false);

  ctx.window.document.getElementById('clearRatingsCache').click();
  await flush();

  // Removal, not an empty write: open tabs treat a write as a normal flush.
  // Flatten: the arrays come from the page realm.
  // The record of endpoints this server does not serve goes with the cache:
  // clearing is the user saying "try again", which includes those.
  assert.deepEqual(ctx.localRemovals.map(keys => [...keys]), [['rtCacheV1', 'seerrRatingsUnavailableV1', 'overlayRatingsV1', 'overlayRatingsByServerV1']]);
  assert.match(ctx.window.document.getElementById('ratingsCacheCount').textContent, /No ratings cached/);
  assert.equal(ctx.window.document.getElementById('clearRatingsCache').disabled, true, 'nothing left to clear');
});

test('Settings counts and clears ratings held for multiple Seerr sites', async t => {
  const ctx = openOptions({ local: { overlayRatingsByServerV1: {
    'https://home.example': { entries: { 'movie:1': {}, 'tv:2': {} } },
    'https://family.example': { entries: { 'movie:1': {} } }
  } } });
  t.after(() => ctx.window.close()); await flush();
  assert.match(ctx.window.document.getElementById('ratingsCacheCount').textContent, /3 cache entries/);
  ctx.window.document.getElementById('clearRatingsCache').click(); await flush();
  assert.match(ctx.window.document.getElementById('ratingsCacheCount').textContent, /No ratings cached/);
});

test('Settings does not count a legacy cache twice while its site cache is being retired', async t => {
  const ctx = openOptions({ local: {
    overlayRatingsV1: { server: 'https://home.example/', entries: { 'movie:1': {}, 'tv:2': {} } },
    overlayRatingsByServerV1: { 'https://home.example': { server: 'https://home.example', entries: { 'movie:1': {}, 'tv:2': {} } } }
  } });
  t.after(() => ctx.dom.window.close()); await flush();
  assert.equal(ctx.window.document.getElementById('ratingsCacheCount').textContent, '2 cache entries');
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

test('Test Seerr requests host access in the click gesture before testing without saving', async t => {
  const ctx = openOptions(); t.after(() => ctx.window.close()); await flush();
  const events = [];
  ctx.window.chrome.permissions.request = async ({ origins }) => {
    events.push('permission'); assert.deepEqual([...origins], ['http://localhost/*']); return true;
  };
  ctx.window.chrome.runtime.sendMessage = async message => {
    events.push(message.action); return { success: true, data: { user: 'Test account' } };
  };
  const doc = ctx.window.document;
  doc.getElementById('serverUrl').value = 'http://localhost:5055/seerr';
  doc.getElementById('apiKey').value = 'test-key';
  doc.getElementById('testConnection').click();
  assert.deepEqual(events, ['permission'], 'permission must be requested synchronously from the click');
  await flush();
  assert.deepEqual(events, ['permission', 'testConnection']);
  assert.equal(ctx.syncWrites.length, 0); assert.equal(ctx.localWrites.length, 0);
});

test('Test Seerr stops on declined access and ignores edits made during the permission prompt', async t => {
  for (const edited of [false, true]) {
    const ctx = openOptions(); t.after(() => ctx.window.close()); await flush();
    let resolvePermission, messages = 0;
    ctx.window.chrome.permissions.request = () => new Promise(resolve => { resolvePermission = resolve; });
    ctx.window.chrome.runtime.sendMessage = async () => { messages++; return { success: true, data: { user: 'Old account' } }; };
    const doc = ctx.window.document;
    doc.getElementById('serverUrl').value = 'https://original.example';
    doc.getElementById('apiKey').value = 'test-key';
    doc.getElementById('testConnection').click();
    assert.equal(typeof resolvePermission, 'function');
    if (edited) doc.getElementById('serverUrl').value = 'https://edited.example';
    resolvePermission(edited); await flush();
    assert.equal(messages, 0);
    assert.match(doc.getElementById('status').textContent, edited ? /Settings changed.*Test again/ : /permission/i);
    assert.equal(doc.getElementById('testConnection').disabled, false);
  }
});

test('granting Seerr access during a test clears the saved server permission warning', async t => {
  const ctx = openOptions({ granted: false, synced: { seerrUrl: 'https://saved.example' }, local: { seerrApiKey: 'key' } });
  t.after(() => ctx.window.close()); await flush();
  assert.equal(warningHidden(ctx.window), false);
  ctx.window.chrome.permissions.request = async () => true;
  ctx.window.chrome.permissions.contains = async () => true;
  ctx.window.chrome.runtime.sendMessage = async () => ({ success: true, data: { user: 'Test account' } });
  ctx.window.document.getElementById('testConnection').click(); await flush();
  assert.equal(warningHidden(ctx.window), true);
  assert.match(ctx.window.document.getElementById('status').textContent, /Connected as Test account/);
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
  await flush(); // Let Seerr's permission grant finish and its request start.
  doc.getElementById('testPlexConnection').click(); await flush();
  pending.plexTestConnection.resolve({ success: true, data: { user: 'New account' } }); await flush();
  pending.testConnection.reject(new Error('Old failure')); await flush();
  assert.match(doc.getElementById('status').textContent, /Plex connected as New account/);
  assert.equal(doc.getElementById('testConnection').disabled, false);
});

test('a failed saved-site read restores the selector to the site whose fields remain visible', async t => {
  const home = { id: 'https://home.example', url: 'https://home.example', apiKey: 'home-key', name: 'Home' };
  const family = { id: 'https://family.example', url: 'https://family.example', apiKey: 'family-key', name: 'Family' };
  const ctx = openOptions({ local: { seerrConnectionsV1: { activeId: home.id, sites: [home, family] } } });
  t.after(() => ctx.dom.window.close());
  ctx.window.chrome.runtime.sendMessage = async () => ({ success: true, data: { activeId: home.id, sites: [home, family] } });
  await flush();
  const select = ctx.window.document.getElementById('savedSeerrSites');
  assert.equal(select.value, home.id);
  ctx.window.chrome.storage.local.get = async () => { throw new Error('Read failed'); };
  select.value = family.id; select.dispatchEvent(new ctx.window.Event('change'));
  await flush();
  assert.equal(select.value, home.id);
  assert.equal(ctx.window.document.getElementById('apiKey').value, 'home-key');
  assert.equal(ctx.window.document.getElementById('serverUrl').value, home.url);
  assert.match(ctx.window.document.getElementById('status').textContent, /Could not load this site/);
});

for (const timing of ['initial load', 'external switch']) {
  test(`saved-site metadata preserves the edited site during ${timing}`, async t => {
    const home = { id: 'https://home.example', url: 'https://home.example', apiKey: 'home-key', name: 'Home' };
    const family = { id: 'https://family.example', url: 'https://family.example', apiKey: 'family-key', name: 'Family' };
    let activeId = timing === 'initial load' ? family.id : home.id;
    const ctx = openOptions({ local: { seerrConnectionsV1: { activeId: home.id, sites: [home, family] } } });
    t.after(() => ctx.window.close());
    ctx.window.chrome.runtime.sendMessage = async () => ({ success: true, data: { activeId, sites: [home, family] } });
    await flush();
    const doc = ctx.window.document;
    if (timing === 'external switch') {
      doc.getElementById('apiKey').value = 'unsaved-key';
      activeId = family.id;
      ctx.storageListeners.forEach(listener => listener({ seerrConnectionsV1: { newValue: { activeId } } }, 'local'));
      await flush();
    }
    assert.equal(doc.getElementById('savedSeerrSites').value, home.id);
    assert.equal(doc.getElementById('serverUrl').value, home.url);
    assert.equal(doc.getElementById('apiKey').value, timing === 'initial load' ? 'home-key' : 'unsaved-key');
    assert.match(doc.getElementById('activeSeerrSite').textContent, /Active site: Family/);
    assert.equal(doc.getElementById('useSeerrSite').disabled, false);
  });
}

test('saving a renamed site keeps its confirmed identity when another site becomes active', async t => {
  const home = { id: 'https://home.example', url: 'https://home.example', apiKey: 'home-key', name: 'Home' };
  const family = { id: 'https://family.example', url: 'https://family.example', apiKey: 'family-key', name: 'Family' };
  const ctx = openOptions({ local: { seerrConnectionsV1: { activeId: home.id, sites: [home, family] } } });
  t.after(() => ctx.window.close());
  let sites = [home, family], activeId = home.id;
  const saves = [];
  ctx.window.chrome.runtime.sendMessage = async ({ action, data }) => {
    if (action === 'saveSeerrConnection') {
      saves.push(data);
      const saved = { ...data, id: data.url };
      sites = [saved, family]; activeId = family.id;
      return { success: true, data: { activeId: saved.id, sites } };
    }
    return { success: true, data: { activeId, sites } };
  };
  await flush();
  const doc = ctx.window.document;
  doc.getElementById('serverUrl').value = 'https://moved.example';
  doc.getElementById('settingsForm').dispatchEvent(new ctx.window.Event('submit'));
  await flush();
  assert.equal(doc.getElementById('savedSeerrSites').value, 'https://moved.example');
  assert.match(doc.getElementById('activeSeerrSite').textContent, /Active site: Family/);
  doc.getElementById('settingsForm').dispatchEvent(new ctx.window.Event('submit'));
  await flush();
  assert.equal(saves[1].id, 'https://moved.example', 'the next save must edit the same site as the visible fields');
});

test('a background site-list refresh preserves a new-site draft', async t => {
  const home = { id: 'https://home.example', url: 'https://home.example', apiKey: 'home-key', name: 'Home' };
  const ctx = openOptions({ local: { seerrConnectionsV1: { activeId: home.id, sites: [home] } } });
  t.after(() => ctx.window.close());
  ctx.window.chrome.runtime.sendMessage = async () => ({ success: true, data: { activeId: home.id, sites: [home] } });
  await flush();
  const doc = ctx.window.document;
  doc.getElementById('addSeerrSite').click();
  doc.getElementById('serverUrl').value = 'https://draft.example';
  doc.getElementById('apiKey').value = 'draft-key';
  ctx.storageListeners.forEach(listener => listener({ seerrConnectionsV1: {} }, 'local'));
  await flush();
  assert.equal(doc.getElementById('savedSeerrSites').value, '');
  assert.match(doc.getElementById('savedSeerrSites').selectedOptions[0].textContent, /New site/);
  assert.equal(doc.getElementById('serverUrl').value, 'https://draft.example');
  assert.equal(doc.getElementById('apiKey').value, 'draft-key');
  assert.equal(doc.getElementById('useSeerrSite').disabled, true);
  assert.equal(doc.getElementById('removeSeerrSite').disabled, true);
});

test('an open legacy Settings window saves to profiles after another window adds a site', async t => {
  const home = { id: 'https://home.example', url: 'https://home.example', apiKey: 'home-key', name: 'Home' };
  const family = { id: 'https://family.example', url: 'https://family.example', apiKey: 'family-key', name: 'Family' };
  const ctx = openOptions({ synced: { seerrUrl: home.url }, local: { seerrApiKey: home.apiKey } });
  t.after(() => ctx.window.close());
  let connections = { revision: 0, activeId: home.id, sites: [home] };
  let saved;
  ctx.window.chrome.runtime.sendMessage = async ({ action, data }) => {
    if (action === 'saveSeerrConnection') {
      saved = data;
      connections = { ...connections, revision: 2, activeId: home.id };
    }
    return { success: true, data: connections };
  };
  await flush();
  connections = { revision: 1, activeId: family.id, sites: [home, family] };
  ctx.storageListeners.forEach(listener => listener({ seerrConnectionsV1: { newValue: connections } }, 'local'));
  await flush();
  const doc = ctx.window.document;
  doc.getElementById('apiKey').value = 'edited-home-key';
  doc.getElementById('settingsForm').dispatchEvent(new ctx.window.Event('submit'));
  await flush();
  assert.equal(saved?.id, home.id);
  assert.equal(saved?.apiKey, 'edited-home-key');
  assert.ok(ctx.localWrites.every(write => !Object.hasOwn(write, 'seerrApiKey')), 'retired legacy keys must not receive edits');
});

for (const mode of ['legacy', 'profile']) test(`a pending ${mode} save keeps one form snapshot and identifies newer edits`, async t => {
  const home = { id: 'https://home.example', url: 'https://home.example', name: 'Home', apiKey: 'home-key' };
  const ctx = openOptions({ synced: { seerrUrl: home.url }, local: mode === 'profile' ? {
    seerrConnectionsV1: { revision: 1, activeId: home.id, sites: [home] }
  } : { seerrApiKey: home.apiKey } });
  t.after(() => ctx.window.close());
  const saved = [];
  ctx.window.chrome.runtime.sendMessage = async ({ action, data }) => {
    if (action === 'saveSeerrConnection') saved.push(data);
    return { success: true, data: { revision: mode === 'profile' ? 1 : 0, activeId: home.id, sites: [home] } };
  };
  await flush();
  let release;
  ctx.window.chrome.permissions.request = () => new Promise(resolve => { release = resolve; });
  const doc = ctx.window.document, feature = doc.querySelector('[data-overlay-feature]');
  feature.checked = true; doc.getElementById('debugLogging').checked = false;
  doc.getElementById('settingsForm').dispatchEvent(new ctx.window.Event('submit'));
  doc.getElementById('serverUrl').value = 'https://new-draft.example';
  doc.getElementById('apiKey').value = 'new-draft-key';
  feature.checked = false; doc.getElementById('debugLogging').checked = true;
  release(true); await flush();
  assert.equal(ctx.syncWrites[0].overlayFeatures[feature.dataset.overlayFeature], true);
  assert.equal(ctx.localWrites[0].debugLogging, false);
  if (mode === 'profile') { assert.equal(saved[0].url, home.url); assert.equal(saved[0].apiKey, home.apiKey); }
  else { assert.equal(ctx.syncWrites[0].seerrUrl, home.url); assert.equal(ctx.localWrites[0].seerrApiKey, home.apiKey); }
  assert.equal(doc.getElementById('serverUrl').value, 'https://new-draft.example');
  assert.equal(doc.getElementById('apiKey').value, 'new-draft-key');
  assert.equal(feature.checked, false);
  assert.equal(doc.getElementById('debugLogging').checked, true);
  assert.match(doc.getElementById('status').textContent, /newer edits.*not saved/i);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
const initialAccounts = () => ['trakt', 'simkl'].map(provider => ({ provider, name: provider, clientId: `${provider}-app`, connected: false,
  callbackUrl: `https://extension.chromiumapp.org/tracker/${provider}`, lastSyncAt: null, accountRevision: 'initial-account' }));

async function fixture(t, handler) {
  const dom = new JSDOM('<section id="trackerAccounts"></section>', { url: 'https://extension.example/options', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const f = { window: dom.window, doc: dom.window.document, accounts: initialAccounts(), messages: [], permissions: [], opened: [], storageListeners: [], server: 'https://seerr.example/base/' };
  f.reply = data => ({ success: true, data: JSON.parse(JSON.stringify(data)) });
  f.window.chrome = {
    storage: { onChanged: { addListener: listener => f.storageListeners.push(listener) } },
    tabs: { create: async options => f.opened.push(options) },
    permissions: { request: options => { f.permissions.push(options); return Promise.resolve(true); } },
    runtime: { sendMessage: async message => {
      f.messages.push(message);
      if (handler) { const handled = await handler(message, f); if (handled !== undefined) return handled; }
      if (message.action === 'getConfigState') return f.reply({ serverUrl: f.server });
      if (message.action === 'saveTrackerApp') Object.assign(f.accounts.find(item => item.provider === message.data.provider), { clientId: message.data.clientId, connected: false });
      if (message.action === 'connectTracker') f.accounts.find(item => item.provider === message.data.provider).connected = true;
      if (message.action === 'disconnectTracker') f.accounts.find(item => item.provider === message.data.provider).connected = false;
      if (message.action === 'getTrackerWatchlist') return f.reply({ provider: message.data.provider, page: message.data.page,
        items: [{ title: 'Film & television / 日本語', year: 1999, mediaType: 'movie' }], nextPage: null, hasMore: false, skipped: 0, lastSyncAt: 123456789 });
      return f.reply(f.accounts);
    } }
  };
  f.window.eval(fs.readFileSync('src/options/tracker-accounts.js', 'utf8'));
  await settle();
  f.manager = f.window.trackerAccounts;
  f.card = provider => f.manager.cards.get(provider);
  f.notifyAccounts = () => {
    const newValue = Object.fromEntries(f.accounts.map(account => [account.provider,
      { clientId: account.clientId, accountRevision: account.accountRevision }]));
    for (const listener of f.storageListeners) listener({ trackerAccountsV1: { newValue } }, 'local');
  };
  return f;
}

test('tracker startup exposes public app and callback state, with account reads isolated from the Seerr form', async t => {
  const f = await fixture(t);
  assert.equal(f.card('trakt').input.value, 'trakt-app');
  assert.match(f.card('simkl').callback.value, /tracker\/simkl$/);
  assert.equal(f.card('trakt').connect.disabled, false);
  assert.equal(f.card('trakt').save.disabled, true);
  assert.equal(f.card('trakt').sync.disabled, true);
  assert.equal(f.doc.querySelector('form'), null);
  assert.equal(f.messages[0].action, 'getTrackerAccounts');
  assert.match(f.card('simkl').root.querySelector('.tracker-help').textContent, /Mobile, desktop & browser apps.*AUTH V2/);
  assert.doesNotMatch(f.card('trakt').root.querySelector('.tracker-help').textContent, /AUTH V2/);
});

test('callback URLs can be copied directly from the provider setup card', async t => {
  const f = await fixture(t);
  const copied = [];
  Object.defineProperty(f.window.navigator, 'clipboard', { configurable: true, value: { writeText: async value => copied.push(value) } });
  const card = f.card('simkl');
  card.copyCallback.click(); await settle();
  assert.deepEqual(copied, ['https://extension.chromiumapp.org/tracker/simkl']);
  assert.match(card.status.textContent, /Callback URL copied/);
});

test('callback copy explains when clipboard access is unavailable', async t => {
  const f = await fixture(t);
  const card = f.card('trakt');
  card.copyCallback.click(); await settle();
  assert.match(card.status.textContent, /Could not copy.*manually/);
});

test('editing an app ID requires an explicit Save before account authorization', async t => {
  const f = await fixture(t);
  const card = f.card('trakt');
  card.input.value = ' edited-app ';
  card.input.dispatchEvent(new f.window.Event('input'));
  assert.equal(card.connect.disabled, true);
  card.save.click();
  await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(f.messages.find(message => message.action === 'saveTrackerApp').data)), { provider: 'trakt', clientId: 'edited-app' });
  assert.equal(card.connect.disabled, false);
  assert.equal(card.input.value, 'edited-app');
});

test('Connect requests optional permission immediately during its click before messaging for OAuth', async t => {
  const f = await fixture(t);
  f.card('trakt').connect.click();
  assert.equal(f.permissions.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.permissions[0].origins)), ['https://api.trakt.tv/*', 'https://auth.trakt.tv/*']);
  assert.equal(f.messages.some(message => message.action === 'connectTracker'), false);
  await settle();
  assert.equal(f.card('trakt').account.connected, true);
  assert.equal(f.card('trakt').sync.disabled, false);
});

test('declined host permission leaves the account disconnected without launching OAuth', async t => {
  const f = await fixture(t);
  f.window.chrome.permissions.request = async () => false;
  f.card('simkl').connect.click();
  await settle();
  assert.equal(f.messages.some(message => message.action === 'connectTracker'), false);
  assert.equal(f.card('simkl').account.connected, false);
  assert.match(f.card('simkl').status.textContent, /not granted/);
  assert.equal(f.card('simkl').connect.disabled, false);
});

test('disconnect remains available during an account read and rejects its late watchlist', async t => {
  let finishRead;
  const f = await fixture(t, (message, state) => {
    if (message.action === 'getTrackerWatchlist') return new Promise(resolve => { finishRead = () => resolve(state.reply({ provider: 'trakt', page: 1,
      items: [{ title: 'Late private title', mediaType: 'movie' }], nextPage: null, hasMore: false })); });
  });
  f.card('trakt').connect.click(); await settle();
  const card = f.card('trakt');
  card.sync.click(); await settle();
  assert.equal(card.disconnect.disabled, false);
  assert.equal(card.sync.disabled, true);
  card.disconnect.click(); await settle();
  finishRead(); await settle();
  assert.equal(card.account.connected, false);
  assert.equal(card.items.length, 0);
  assert.equal(card.list.textContent, '');
  assert.match(card.summary.textContent, /Not connected/);
  assert.match(card.status.textContent, /Disconnected/);
});

test('cancelling connection prevents an obsolete authorization reply from reconnecting the UI', async t => {
  let finishConnect;
  const f = await fixture(t, (message, state) => {
    if (message.action === 'connectTracker') return new Promise(resolve => { finishConnect = () => resolve(state.reply(state.accounts.map(account => ({ ...account, connected: true })))); });
  });
  const card = f.card('trakt');
  card.connect.click(); await settle();
  assert.equal(card.disconnect.textContent, 'Cancel connection');
  card.disconnect.click(); await settle();
  finishConnect(); await settle();
  assert.equal(card.account.connected, false);
  assert.equal(card.sync.disabled, true);
  assert.match(card.status.textContent, /Disconnected/);
});

test('manual watchlist reads expose literal titles, skip unsupported entries, and use fresh Seerr destinations', async t => {
  const f = await fixture(t);
  const card = f.card('trakt');
  card.connect.click(); await settle();
  card.sync.click(); await settle();
  assert.equal(card.items.length, 1);
  assert.match(card.list.textContent, /Film & television \/ 日本語/);
  f.server = 'https://family.example/seerr///';
  card.list.querySelector('button').click(); await settle();
  const url = new URL(f.opened[0].url);
  assert.equal(url.origin, 'https://family.example');
  assert.equal(url.pathname, '/seerr/search');
  assert.equal(url.searchParams.get('query'), 'Film & television / 日本語');
  assert.equal(f.messages.some(message => message.action === 'requestMedia'), false);
});

test('a Seerr site switch while Find in Seerr is reading config cannot open the old destination', async t => {
  let finishConfig, configReads = 0;
  const f = await fixture(t, (message, state) => {
    if (message.action === 'getConfigState') {
      const server = state.server;
      if (++configReads === 1) return new Promise(resolve => { finishConfig = () => resolve(state.reply({ serverUrl: server, connectionToken: server })); });
      return state.reply({ serverUrl: state.server, connectionToken: state.server });
    }
  });
  const card = f.card('trakt');
  card.connect.click(); await settle();
  card.sync.click(); await settle();
  const find = card.list.querySelector('button');
  find.click(); await settle();
  assert.equal(typeof finishConfig, 'function');
  finishConfig();
  f.server = 'https://family.example/seerr/';
  await settle();
  assert.equal(f.opened.length, 0, 'a stale config must not open a previous Seerr site');
  assert.match(card.status.textContent, /changed|active site/i);
});

for (const server of ['javascript:alert(1)', 'https://user:secret@seerr.example/', 'https://seerr.example/?token=secret', null]) {
  test(`tracker title search rejects an unsafe or missing Seerr destination (${server})`, async t => {
    const f = await fixture(t);
    const card = f.card('simkl');
    card.connect.click(); await settle();
    card.sync.click(); await settle();
    f.server = server;
    card.list.querySelector('button').click(); await settle();
    assert.equal(f.opened.length, 0);
    assert.match(card.status.textContent, /Seerr server URL/);
  });
}

test('watchlist pagination is explicit and refuses pages beyond the bounded review', async t => {
  const f = await fixture(t, (message, state) => {
    if (message.action === 'getTrackerWatchlist') return state.reply({ provider: 'simkl', page: message.data.page,
      items: [{ title: '<img src=x onerror=alert(1)>', mediaType: 'movie' }, { title: 'Episode', mediaType: 'episode' }],
      nextPage: message.data.page + 1, hasMore: true, skipped: 2 });
  });
  const card = f.card('simkl');
  card.connect.click(); await settle();
  card.sync.click(); await settle();
  assert.equal(card.list.querySelectorAll('img').length, 0);
  assert.equal(card.items.length, 1);
  assert.equal(card.more.hidden, false);
  assert.equal(f.messages.filter(message => message.action === 'getTrackerWatchlist').length, 1);
  for (let i = 2; i <= 5; i++) { card.more.click(); await settle(); }
  assert.equal(card.more.hidden, true);
  assert.equal(card.items.length, 5);
  assert.match(card.status.textContent, /limited to 500/);
  await f.manager.loadWatchlist(card, 6);
  assert.equal(f.messages.filter(message => message.action === 'getTrackerWatchlist').length, 5);
});

test('account reload clears private titles when another context disconnected the account', async t => {
  const f = await fixture(t);
  const card = f.card('simkl');
  card.connect.click(); await settle();
  card.sync.click(); await settle();
  assert.equal(card.items.length, 1);
  f.accounts.find(account => account.provider === 'simkl').connected = false;
  await f.manager.loadAccounts();
  assert.equal(card.items.length, 0);
  assert.equal(card.list.textContent, '');
  assert.equal(card.sync.disabled, true);
});

test('account revision changes clear imported titles even when a different account uses the same app ID', async t => {
  const f = await fixture(t);
  const card = f.card('trakt');
  card.connect.click(); await settle();
  card.sync.click(); await settle();
  f.accounts.find(account => account.provider === 'trakt').accountRevision = 'different-account';
  f.storageListeners[0]({ trackerAccountsV1: {} }, 'local'); await settle();
  assert.equal(card.account.connected, true);
  assert.equal(card.items.length, 0);
  assert.equal(card.list.textContent, '');
});

test('last-sync or token-refresh storage notifications preserve a pending watchlist read', async t => {
  let finishRead;
  const f = await fixture(t, (message, state) => {
    if (message.action === 'getTrackerWatchlist') return new Promise(resolve => { finishRead = () => resolve(state.reply({ provider: 'trakt', page: 1,
      items: [{ title: 'Current private title', mediaType: 'movie' }], nextPage: null, hasMore: false })); });
  });
  const card = f.card('trakt');
  card.connect.click(); await settle();
  card.sync.click(); await settle();
  f.accounts.find(account => account.provider === 'trakt').lastSyncAt = Date.now();
  f.storageListeners[0]({ trackerAccountsV1: {} }, 'local'); await settle();
  finishRead(); await settle();
  assert.equal(card.items.length, 1);
  assert.match(card.list.textContent, /Current private title/);
});

test('a pending connection does not delay another provider disconnecting in a different window', async t => {
  let finishConnect;
  const f = await fixture(t, (message, state) => {
    if (message.action === 'connectTracker' && message.data.provider === 'trakt') {
      return new Promise(resolve => { finishConnect = () => resolve(state.reply(state.accounts)); });
    }
  });
  const card = f.card('simkl');
  card.connect.click(); await settle();
  card.sync.click(); await settle();
  assert.equal(card.items.length, 1);
  f.card('trakt').connect.click(); await settle();
  const before = f.messages.filter(message => message.action === 'getTrackerAccounts').length;
  Object.assign(f.accounts.find(account => account.provider === 'simkl'), { connected: false, accountRevision: 'disconnected' });
  f.notifyAccounts();
  await settle();
  try {
    assert.ok(f.messages.filter(message => message.action === 'getTrackerAccounts').length > before,
      'public account reads must not wait for an unrelated OAuth window');
    assert.equal(card.items.length, 0);
    assert.equal(card.sync.disabled, true);
    assert.equal(card.account.connected, false);
    assert.equal(f.card('trakt').disconnect.disabled, false, 'the pending authorization can still be cancelled');
  } finally { finishConnect(); await settle(); }
});

test('an account change retires private titles and pending actions before a failed public refresh', async t => {
  let failRefresh, finishConfig, configReads = 0;
  const f = await fixture(t, (message, state) => {
    if (message.action === 'getTrackerAccounts' && failRefresh === true) {
      return new Promise(resolve => { failRefresh = () => resolve({ success: false, error: 'Account state temporarily unavailable' }); });
    }
    if (message.action === 'getConfigState') {
      configReads++;
      return new Promise(resolve => { finishConfig = () => resolve(state.reply({ serverUrl: state.server })); });
    }
  });
  const card = f.card('trakt');
  card.connect.click(); await settle();
  card.sync.click(); await settle();
  card.input.value = 'unsaved-app'; card.input.dispatchEvent(new f.window.Event('input'));
  card.list.querySelector('button').click(); await settle();
  Object.assign(f.accounts.find(account => account.provider === 'trakt'), { connected: false, accountRevision: 'disconnected' });
  failRefresh = true;
  f.notifyAccounts();
  await settle();
  const stale = { titles: card.list.textContent, syncDisabled: card.sync.disabled };
  finishConfig(); failRefresh(); await settle();
  assert.equal(stale.titles, '', 'private titles retire while the new public metadata is pending');
  assert.equal(stale.syncDisabled, true);
  assert.equal(f.opened.length, 0);
  assert.equal(configReads, 1, 'retired title actions stop before further config reads');
  assert.equal(card.input.value, 'unsaved-app', 'unsaved Client ID edits survive refresh failures');
  assert.equal(card.sync.disabled, true);
  assert.match(f.manager.status.textContent, /temporarily unavailable/);
  assert.match(card.status.textContent, /Could not check.*Reload account connections/);
  assert.equal(f.manager.retry.disabled, false);
  f.manager.retry.click(); await settle();
  assert.equal(card.account.connected, false);
  assert.equal(card.input.value, 'unsaved-app');
  assert.equal(card.input.disabled, false);
});

for (const provider of ['trakt', 'simkl']) test(`${provider} account changes reject delayed watchlist rows while public state is still pending`, async t => {
  let finishRead, finishAccounts, delayAccounts = false;
  const f = await fixture(t, (message, state) => {
    if (message.action === 'getTrackerWatchlist') return new Promise(resolve => { finishRead = () => resolve(state.reply({ provider, page: 1,
      items: [{ title: 'Previous account private title', mediaType: 'movie' }], nextPage: null })); });
    if (message.action === 'getTrackerAccounts' && delayAccounts) return new Promise(resolve => {
      finishAccounts = () => resolve(state.reply(state.accounts));
    });
  });
  const card = f.card(provider);
  card.connect.click(); await settle();
  card.sync.click(); await settle();
  Object.assign(f.accounts.find(account => account.provider === provider), { accountRevision: 'new-account' });
  delayAccounts = true; f.notifyAccounts(); await settle();
  finishRead(); await settle();
  assert.equal(card.list.textContent, '');
  assert.equal(card.sync.disabled, true);
  finishAccounts(); await settle();
  assert.equal(card.sync.disabled, false);
  assert.equal(card.account.accountRevision, 'new-account');
  assert.equal(card.items.length, 0);
});

test('unchanged public identity preserves watchlist reads during token rotation and another provider connection', async t => {
  let finishRead, finishConnect;
  const f = await fixture(t, (message, state) => {
    if (message.action === 'connectTracker' && message.data.provider === 'simkl') return new Promise(resolve => {
      finishConnect = () => resolve(state.reply(state.accounts));
    });
    if (message.action === 'getTrackerWatchlist') return new Promise(resolve => { finishRead = () => resolve(state.reply({ provider: 'trakt', page: 1,
      items: [{ title: 'Current account private title', mediaType: 'movie' }], nextPage: null })); });
  });
  const card = f.card('trakt');
  card.connect.click(); await settle();
  card.sync.click(); await settle();
  f.card('simkl').connect.click(); await settle();
  const newValue = Object.fromEntries(f.accounts.map(account => [account.provider, { clientId: account.clientId,
    accountRevision: account.accountRevision, accessToken: 'rotated-fixture', refreshToken: 'rotated-fixture', lastSyncAt: Date.now() }]));
  f.storageListeners[0]({ trackerAccountsV1: { newValue } }, 'local'); await settle();
  finishRead(); await settle();
  assert.match(card.list.textContent, /Current account private title/);
  assert.equal(card.sync.disabled, false);
  assert.doesNotMatch(f.doc.body.textContent, /rotated-fixture/);
  finishConnect(); await settle();
});

test('an older account read cannot overwrite an app save that finishes first', async t => {
  let finishAccounts, delayAccounts = false;
  const f = await fixture(t, (message, state) => {
    if (message.action === 'getTrackerAccounts' && delayAccounts) {
      delayAccounts = false;
      const before = state.reply(state.accounts);
      return new Promise(resolve => { finishAccounts = () => resolve(before); });
    }
  });
  const card = f.card('trakt');
  delayAccounts = true;
  const reading = f.manager.loadAccounts({ invalidateLists: false }); await settle();
  card.input.value = 'new-app'; card.input.dispatchEvent(new f.window.Event('input'));
  card.save.click(); await settle();
  assert.equal(card.account.clientId, 'new-app');
  finishAccounts(); await reading; await settle();
  assert.equal(card.account.clientId, 'new-app');
  assert.equal(card.input.value, 'new-app');
  assert.equal(f.manager.status.textContent, '');
  assert.equal(f.manager.retry.disabled, false);
});

test('deleting stored accounts retires existing titles before the replacement metadata reply', async t => {
  let finishAccounts, delayAccounts = false;
  const f = await fixture(t, (message, state) => {
    if (message.action === 'getTrackerAccounts' && delayAccounts) return new Promise(resolve => {
      finishAccounts = () => resolve(state.reply(state.accounts));
    });
  });
  const card = f.card('simkl');
  card.connect.click(); await settle(); card.sync.click(); await settle();
  const oldValue = Object.fromEntries(f.accounts.map(account => [account.provider, { clientId: account.clientId, accountRevision: account.accountRevision }]));
  Object.assign(f.accounts.find(account => account.provider === 'simkl'), { connected: false, clientId: '', accountRevision: '' });
  delayAccounts = true;
  f.storageListeners[0]({ trackerAccountsV1: { oldValue } }, 'local');
  assert.equal(card.list.textContent, '');
  assert.equal(card.sync.disabled, true);
  await settle(); finishAccounts(); await settle();
  assert.equal(card.account.connected, false);
  assert.equal(card.input.disabled, false);
});

test('deferred metadata refreshes resume for the first finished account while the other is still connecting', async t => {
  const finish = {};
  const f = await fixture(t, (message, state) => {
    if (message.action === 'connectTracker') return new Promise(resolve => {
      finish[message.data.provider] = success => resolve(success ? state.reply(state.accounts)
        : { success: false, error: 'Tracker account changed. Try again.' });
    });
  });
  for (const provider of ['trakt', 'simkl']) { f.card(provider).connect.click(); await settle(); }
  Object.assign(f.accounts.find(account => account.provider === 'simkl'), { clientId: 'another-app', accountRevision: 'changed-app' });
  f.notifyAccounts(); await settle();
  assert.equal(f.card('simkl').disconnect.disabled, false, 'a superseded authorization remains cancellable');
  finish.simkl(false); await settle();
  try {
    assert.equal(f.card('simkl').account.clientId, 'another-app');
    assert.equal(f.card('simkl').input.disabled, false);
    assert.equal(f.card('trakt').disconnect.disabled, false);
    assert.equal(f.manager.retry.disabled, false);
  } finally { finish.trakt(true); await settle(); }
});

test('a restored Settings page retires its old review until account state can be checked', async t => {
  let failAccounts = false;
  const f = await fixture(t, message => {
    if (message.action === 'getTrackerAccounts' && failAccounts) return { success: false, error: 'Account state temporarily unavailable' };
  });
  const card = f.card('trakt');
  card.connect.click(); await settle(); card.sync.click(); await settle();
  failAccounts = true;
  f.window.dispatchEvent(new f.window.PageTransitionEvent('pageshow', { persisted: true }));
  assert.equal(card.list.textContent, '');
  assert.equal(card.sync.disabled, true);
  await settle();
  assert.equal(f.manager.retry.disabled, false);
  assert.match(f.manager.status.textContent, /temporarily unavailable/);
  failAccounts = false; f.manager.retry.click(); await settle();
  assert.equal(card.sync.disabled, false);
});

test('a truncated snapshot shows its review limit even when it has no next page', async t => {
  const f = await fixture(t, (message, state) => {
    if (message.action === 'getTrackerWatchlist') return state.reply({ provider: 'simkl', page: 1,
      items: [{ title: 'Example', mediaType: 'movie' }], nextPage: null, hasMore: false, truncated: true, skipped: 0 });
  });
  const card = f.card('simkl');
  card.connect.click(); await settle();
  card.sync.click(); await settle();
  assert.match(card.status.textContent, /limited to 500/);
});

test('Sync restores revoked host permission while retaining the connected account', async t => {
  const f = await fixture(t);
  const card = f.card('trakt');
  card.connect.click(); await settle();
  f.permissions.length = 0;
  card.sync.click();
  assert.equal(f.permissions.length, 1, 'permission restoration starts within the Sync click gesture');
  await settle();
  assert.equal(card.account.connected, true);
  assert.equal(card.items.length, 1);
  assert.equal(f.messages.some(message => message.action === 'disconnectTracker'), false);
});

test('declined Sync permission preserves the connected account and existing title review', async t => {
  const f = await fixture(t);
  const card = f.card('simkl');
  card.connect.click(); await settle();
  card.sync.click(); await settle();
  const reads = f.messages.filter(message => message.action === 'getTrackerWatchlist').length;
  f.window.chrome.permissions.request = async () => false;
  card.sync.click(); await settle();
  assert.equal(card.account.connected, true);
  assert.equal(card.items.length, 1);
  assert.equal(f.messages.filter(message => message.action === 'getTrackerWatchlist').length, reads);
  assert.match(card.status.textContent, /Choose Sync watchlist/);
});

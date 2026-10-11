const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadIntegration } = require('./helpers/integration');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function fixture(t) {
  const page = loadIntegration();
  t.after(() => page.window.close());
  const integration = new page.window.BaseIntegration('Probe');
  const notices = [];
  integration.ui.createNotification = (...args) => notices.push(args);
  integration.setUILoading = () => {};
  const show = title => {
    integration.mediaData = { title, mediaType: 'movie', tmdbId: title === 'Old' ? 1 : 2 };
    integration.uiElements = {};
  };
  show('Old');
  return { page, integration, notices, show };
}

test('old request completion cannot unlock a new request or name the new title', async t => {
  const f = fixture(t), first = deferred(), second = deferred();
  let calls = 0;
  f.integration.client.requestMedia = () => (++calls === 1 ? first.promise : second.promise);
  const old = f.integration.handleRequest();
  f.integration.cleanupUI(); f.show('New');
  const current = f.integration.handleRequest();
  first.resolve({}); await old;
  assert.equal(f.integration._requestInFlight, true, 'new request must remain locked');
  assert.ok(!f.notices.some(note => note[1].includes('New')), 'old completion must not claim the new title succeeded');
  // A third click must be ignored while the second write is pending.
  await f.integration.handleRequest();
  assert.equal(calls, 2);
  second.resolve({}); await current;
});

for (const action of ['handleWatchlistClick', 'handlePlexWatchlistClick']) {
  const clientAction = action === 'handleWatchlistClick' ? 'addToWatchlist' : 'plexAddToWatchlist';
  test(`${action} coalesces double clicks and ignores replies after navigation`, async t => {
    const f = fixture(t), pending = deferred();
    let calls = 0;
    f.integration.client[clientAction] = () => { calls++; return pending.promise; };
    const first = f.integration[action]();
    const duplicate = f.integration[action]();
    assert.equal(calls, 1);
    f.integration.cleanupUI(); f.show('New');
    pending.resolve({ already: false }); await Promise.all([first, duplicate]);
    assert.equal(f.notices.length, 0);
  });
}

test('late watch lookup cannot open a previous title after navigation', async t => {
  const f = fixture(t), pending = deferred();
  f.integration.client.getMediaStatus = () => pending.promise;
  let opened = 0;
  f.integration.openMediaServer = async () => { opened++; };
  const watching = f.integration.handleWatchButtonClick();
  f.integration.cleanupUI(); f.show('New');
  pending.resolve({ watchUrl: 'https://media.example/old' });
  await watching;
  assert.equal(opened, 0);
});

test('delayed request UI work is canceled when navigating', async t => {
  const f = fixture(t);
  f.integration.client.requestMedia = async () => ({});
  let refreshes = 0;
  f.integration.updateStatus = async () => { refreshes++; };
  // Capture timers rather than sleeping through the 2-second delay.
  const callbacks = new Map(); let next = 1;
  f.page.window.setTimeout = fn => { const id = next++; callbacks.set(id, fn); return id; };
  f.page.window.clearTimeout = id => callbacks.delete(id);
  await f.integration.handleRequest();
  f.integration.cleanupUI(); f.show('New');
  for (const fn of callbacks.values()) fn();
  assert.equal(refreshes, 0);
});

test('an old failed request cannot clear a newer request guard', async t => {
  const f = fixture(t), first = deferred(), second = deferred();
  let calls = 0;
  f.integration.client.requestMedia = () => (++calls === 1 ? first.promise : second.promise);
  const old = f.integration.handleRequest();
  f.integration.cleanupUI(); f.show('New');
  const current = f.integration.handleRequest();
  first.reject(new Error('old failure')); await old;
  assert.equal(f.integration._requestInFlight, true);
  assert.equal(f.notices.length, 0);
  second.resolve({}); await current;
});

test('watch opens immediately and its delayed UI reset cannot cross navigation', async t => {
  const f = fixture(t);
  const calls = [];
  f.page.window.open = url => { calls.push(url); return {}; };
  f.integration.currentStatusData = { status: 'available_watch' };
  const callbacks = new Map(); let next = 1;
  f.page.window.setTimeout = fn => { const id = next++; callbacks.set(id, fn); return id; };
  f.page.window.clearTimeout = id => callbacks.delete(id);
  let updates = 0;
  f.integration.updateUIFromStatus = () => { updates++; };
  await f.integration.openMediaServer('https://media.example/old');
  assert.deepEqual(calls, ['https://media.example/old']);
  f.integration.cleanupUI(); f.show('New');
  f.integration.currentStatusData = { status: 'available' };
  for (const fn of callbacks.values()) fn();
  assert.equal(updates, 0);
});

test('a status read started before a request cannot replace its pending UI', async t => {
  const f = fixture(t), status = deferred(), request = deferred();
  f.integration.uiTheme = 'flyout';
  const renders = [];
  f.integration.ui.updateFlyoutStatus = (...args) => renders.push(args);
  f.integration.ui.updateTabIcon = () => {};
  f.integration.client.sendMessage = async () => ({success:true,data:{plexConfigured:false}});
  f.integration.client.getMediaStatus = () => status.promise;
  f.integration.client.requestMedia = () => request.promise;
  const checking = f.integration.updateStatus();
  await new Promise(resolve => setImmediate(resolve));
  const sending = f.integration.handleRequest();
  status.resolve({status:'available',buttonClass:'request',buttonText:'Request'});
  await checking;
  assert.equal(renders.length, 0, 'obsolete status must not reset the pending request');
  request.resolve({}); await sending;
});

test('refresh started during a media request cannot reset its UI', async t => {
  const f = fixture(t), request = deferred();
  f.integration.uiTheme = 'flyout';
  const renders = [];
  f.integration.ui.updateFlyoutStatus = (...args) => renders.push(args);
  f.integration.ui.updateTabIcon = () => {};
  f.integration.client.sendMessage = async () => ({success:true,data:{plexConfigured:false}});
  f.integration.client.getMediaStatus = async () => ({status:'available',buttonClass:'request'});
  f.integration.client.requestMedia = () => request.promise;
  const sending = f.integration.handleRequest();
  await f.integration.updateStatus();
  assert.equal(renders.length, 0);
  request.resolve({}); await sending;
  await f.integration.updateStatus();
  assert.equal(renders.length, 1, 'refresh resumes after the write settles');
});

test('Retry status remains available while the click handler is active', async t => {
  const f = fixture(t);
  f.integration.currentStatusData = {action:'retryStatus'};
  let reads = 0;
  f.integration.client.sendMessage = async () => ({success:true,data:{plexConfigured:false}});
  f.integration.client.getMediaStatus = async () => { reads++; return {status:'available'}; };
  f.integration.ui.updateButtonStatus = () => {};
  await f.integration.handleRequest();
  assert.equal(reads, 1);
});

for (const watchUrl of ['javascript:alert(1)', 'data:text/html,broken', '/watch/550', 'not a URL', 'https://user:secret@media.example/watch/550']) {
  test(`invalid playback destination cannot open a window: ${watchUrl.split(':')[0]}`, async t => {
    const f = fixture(t);
    const opened = [], rendered = [];
    f.page.window.open = (...args) => { opened.push(args); return {}; };
    f.integration.updateUIFromStatus = status => rendered.push(status);
    f.integration.currentStatusData = { status: 'available_watch', watchUrl };
    await f.integration.handleWatchButtonClick();
    assert.equal(opened.length, 0);
    assert.equal(f.integration.currentStatusData.action, 'retryStatus');
    assert.equal(rendered.at(-1).action, 'retryStatus');
    assert.ok(f.notices.some(note => note[0] === 'Watch URL Not Available'));
  });
}

test('valid local playback URLs preserve their path and detach the discovery page opener', async t => {
  const f = fixture(t), popup = { opener: f.page.window };
  const opened = [];
  f.page.window.open = (...args) => { opened.push(args); return popup; };
  await f.integration.openMediaServer('http://192.168.1.5:8096/web/index.html#!/details?id=550');
  assert.deepEqual(opened, [['http://192.168.1.5:8096/web/index.html#!/details?id=550', '_blank']]);
  assert.equal(popup.opener, null);
  assert.ok(f.notices.some(note => note[0] === 'Opening media server'));
});

for (const source of ['lookup', 'successful add']) {
  test(`Plex membership from ${source} survives a Seerr UI reset but not a title change`, async t => {
    const f = fixture(t), integration = f.integration;
    integration.uiTheme = 'flyout';
    integration.ui.updateTabIcon = () => {};
    integration.plexConfigured = true;
    integration.uiElements = integration.ui.createFlyoutContent(integration.mediaData, f.page.window.document.body);
    integration.currentStatusData = { status: 'available_watch', buttonClass: 'watch', buttonText: 'Watch' };
    if (source === 'lookup') {
      integration.client.sendMessage = async () => ({ success: true, data: { plexConfigured: true } });
      integration.client.getMediaStatus = async () => integration.currentStatusData;
      integration.client.plexWatchlistState = async () => ({ onWatchlist: true });
      await integration.updateStatus();
      await new Promise(resolve => setImmediate(resolve));
    } else {
      integration.client.plexAddToWatchlist = async () => ({ already: false });
      await integration.handlePlexWatchlistClick();
    }
    assert.equal(integration.uiElements.plexButton.disabled, true);
    integration.setUILoading('Opening...', 'Opening...');
    integration.updateUIFromStatus(integration.currentStatusData);
    assert.equal(integration.uiElements.plexButton.disabled, true, 'restoring Seerr status must retain known Plex membership');
    assert.match(integration.uiElements.plexButton.textContent, /On Plex Watchlist/);
    integration.cleanupUI(); f.show('New');
    integration.uiElements = integration.ui.createFlyoutContent(integration.mediaData, f.page.window.document.body);
    integration.updateUIFromStatus({ status: 'available', buttonClass: 'request' });
    assert.equal(integration.uiElements.plexButton.disabled, false, 'membership must not carry to a different title or connection');
  });
}

for (const change of ['title', 'connection']) {
  test(`collapsed panel extraction clears Plex membership on ${change} changes`, async t => {
    const f = fixture(t), integration = f.integration;
    integration.plexOnWatchlist = true;
    integration._mediaConnectionToken = 'old-site';
    const nextMedia = change === 'title' ? { title: 'New', mediaType: 'movie', tmdbId: 2 } : { ...integration.mediaData };
    integration.extractMediaData = async () => nextMedia;
    integration.client.sendMessage = async message => ({ success: true, data: message.action === 'getConfigState'
      ? { connectionToken: change === 'connection' ? 'new-site' : 'old-site' } : null });
    let renderedMembership;
    integration.setupUI = async () => { renderedMembership = integration.plexOnWatchlist; };
    await integration.extractAndSetup();
    assert.equal(renderedMembership, false);
  });
}

for (const [name, reply, configured, expected] of [
  ['unavailable read', null, true, true],
  ['unknown read', { onWatchlist: false, unknown: true }, true, true],
  ['confirmed removal', { onWatchlist: false }, true, false],
  ['disconnected Plex account', null, false, false]
]) {
  test(`Plex membership handles ${name} without guessing`, async t => {
    const f = fixture(t), integration = f.integration;
    integration.uiTheme = 'flyout';
    integration.ui.updateTabIcon = () => {};
    integration.uiElements = integration.ui.createFlyoutContent(integration.mediaData, f.page.window.document.body);
    integration.plexOnWatchlist = true;
    integration.client.sendMessage = async () => ({ success: true, data: { plexConfigured: configured } });
    integration.client.getMediaStatus = async () => ({ status: 'available', buttonClass: 'request' });
    integration.client.plexWatchlistState = async () => reply;
    await integration.updateStatus();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(integration.plexOnWatchlist, expected);
    assert.equal(integration.uiElements.plexButton.disabled, expected);
  });
}

for (const failure of ['window creation', 'opener detachment']) {
  test(`playback ${failure} failure restores Watch and permits a retry`, async t => {
    const f = fixture(t), integration = f.integration;
    integration.uiElements.button = integration.ui.createRequestButton({ text: 'Watch' });
    f.page.window.document.body.append(integration.uiElements.button);
    integration.setUILoading = f.page.window.BaseIntegration.prototype.setUILoading;
    integration.currentStatusData = { status: 'available_watch', buttonClass: 'watch', buttonText: 'Watch', watchUrl: 'https://media.example/watch/1' };
    integration.updateUIFromStatus(integration.currentStatusData);
    let attempts = 0, closed = 0;
    f.page.window.open = () => {
      if (++attempts > 1) return {};
      if (failure === 'window creation') throw new Error('Browser policy prevented opening');
      return Object.defineProperty({ close: () => { closed++; } }, 'opener', { set() { throw new Error('Could not detach opener'); } });
    };
    await integration.handleRequest();
    assert.equal(integration.uiElements.button.disabled, false);
    assert.equal(integration.uiElements.button.querySelector('span').textContent, 'Watch');
    assert.equal(integration._requestInFlight, false);
    assert.ok(f.notices.some(note => note[0] === 'Could Not Open Media Server'));
    assert.ok(!f.notices.some(note => note[0] === 'Opening media server'));
    assert.equal(closed, failure === 'opener detachment' ? 1 : 0);
    await integration.handleRequest();
    assert.equal(attempts, 2);
    assert.ok(f.notices.some(note => note[0] === 'Opening media server'));
  });
}

test('a playback error after a view change cannot alter the new title controls', async t => {
  const f = fixture(t);
  f.integration.currentStatusData = { status: 'available_watch', watchUrl: 'https://media.example/watch/1' };
  let renders = 0;
  f.integration.updateUIFromStatus = () => { renders++; };
  f.page.window.open = () => {
    f.integration.cleanupUI(); f.show('New');
    throw new Error('Old browser operation failed');
  };
  await f.integration.handleWatchButtonClick();
  assert.equal(renders, 0);
  assert.equal(f.notices.length, 0);
  assert.equal(f.integration.mediaData.title, 'New');
});

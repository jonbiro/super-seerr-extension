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

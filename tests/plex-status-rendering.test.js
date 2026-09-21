const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadIntegration } = require('./helpers/integration');
const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture(t) {
  const page = loadIntegration();
  t.after(() => page.window.close());
  const integration = new page.window.BaseIntegration('Probe');
  integration.mediaData = { title: 'Example', mediaType: 'movie', tmdbId: 1 };
  integration.uiTheme = 'flyout';
  integration.uiElements = {};
  const renders = [], plexUpdates = [];
  let resolvePlex, rejectPlex;
  integration.client.sendMessage = async () => ({ success: true, data: { plexConfigured: true } });
  integration.client.getMediaStatus = async () => ({ status: 'available', buttonClass: 'request' });
  integration.client.plexWatchlistState = () => new Promise((resolve, reject) => { resolvePlex = resolve; rejectPlex = reject; });
  integration.ui.updateFlyoutStatus = (...args) => renders.push(args);
  integration.ui.updatePlexWatchlistStatus = (...args) => plexUpdates.push(args);
  integration.ui.updateTabIcon = () => {};
  return { integration, renders, plexUpdates, resolve: value => resolvePlex(value), reject: () => rejectPlex(new Error('offline')) };
}

test('Seerr renders while Plex is pending; Plex updates separately', async t => {
  const f = fixture(t);
  let finished = false;
  const updating = f.integration.updateStatus().then(() => { finished = true; });
  await settle();
  assert.equal(f.renders.length, 1);
  assert.equal(finished, true);
  f.resolve({ onWatchlist: true });
  await updating; await settle();
  assert.equal(f.renders.length, 1);
  assert.equal(f.plexUpdates[0][2].plexOnWatchlist, true);
});

for (const invalidate of ['navigation', 'destroy', 'new status', 'watchlist click']) {
  test(`late Plex result is ignored after ${invalidate}`, async t => {
    const f = fixture(t);
    await f.integration.updateStatus();
    if (invalidate === 'navigation') f.integration.cleanupUI();
    if (invalidate === 'destroy') f.integration.destroy();
    if (invalidate === 'new status') f.integration.currentStatusData = { status: 'pending' };
    if (invalidate === 'watchlist click') {
      f.integration.client.plexAddToWatchlist = async () => ({ already: false });
      f.integration.ui.createNotification = () => {};
      await f.integration.handlePlexWatchlistClick();
    }
    f.resolve({ onWatchlist: true }); await settle();
    assert.equal(f.plexUpdates.length, 0);
  });
}

test('Plex failure leaves Seerr rendered without an error state', async t => {
  const f = fixture(t);
  await f.integration.updateStatus();
  f.reject(); await settle();
  assert.equal(f.renders.length, 1);
  assert.equal(f.integration.currentStatusData.status, 'available');
});

test('late Plex rendering changes only its own button', t => {
  const page = loadIntegration();
  t.after(() => page.window.close());
  const ui = new page.window.UIComponents();
  const button = page.window.document.createElement('button');
  const plexButton = page.window.document.createElement('button');
  plexButton.innerHTML = '<span>Add to Plex Watchlist</span>';
  button.textContent = 'Request Pending';
  button.disabled = true;
  ui.updatePlexWatchlistStatus({ button, plexButton }, { status: 'available' }, {
    plexConfigured: true, plexOnWatchlist: true
  });
  assert.equal(button.textContent, 'Request Pending');
  assert.equal(button.disabled, true);
  assert.equal(plexButton.textContent, 'On Plex Watchlist ✓');
  assert.equal(plexButton.disabled, true);
});

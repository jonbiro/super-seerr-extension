const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadIntegration } = require('./helpers/integration');
for (const outcome of ['added', 'already', 'failed']) {
  test(`Plex add button has correct final state when ${outcome}`, async t => {
    const f = loadIntegration(); t.after(() => f.window.close());
    const integration = new f.window.BaseIntegration('Probe');
    integration.mediaData = { title:'Example', mediaType:'movie', tmdbId:1 };
    const button = f.window.document.createElement('button');
    button.innerHTML = '<span>Add to Plex Watchlist</span>';
    f.window.document.body.append(button);
    integration.uiElements = { plexButton:button };
    integration.ui.createNotification = () => {};
    integration.client.plexAddToWatchlist = async () => {
      if (outcome === 'failed') throw new Error('offline');
      return { already: outcome === 'already' };
    };
    await integration.handlePlexWatchlistClick();
    assert.equal(button.disabled, outcome !== 'failed');
    if (outcome === 'failed') assert.equal(button.textContent, 'Add to Plex Watchlist');
  });
}

test('status refresh during a Plex add preserves its pending button', async t => {
  const f = loadIntegration(); t.after(() => f.window.close());
  const integration = new f.window.BaseIntegration('Probe', { uiTheme: 'flyout' });
  integration.mediaData = { title:'Example', mediaType:'movie', tmdbId:1 };
  const button = f.window.document.createElement('button');
  button.innerHTML = '<span>Add to Plex Watchlist</span>';
  f.window.document.body.append(button);
  integration.uiElements = { plexButton:button };
  integration.ui.createNotification = () => {};
  integration.ui.updateTabIcon = () => {};
  integration.ui.updateFlyoutStatus = (elements, status, options) => integration.ui.updatePlexWatchlistStatus(elements, status, options);
  integration.client.sendMessage = async () => ({success:true,data:{plexConfigured:true}});
  integration.client.getMediaStatus = async () => ({status:'available'});
  integration.client.plexWatchlistState = async () => ({onWatchlist:false});
  let finish;
  integration.client.plexAddToWatchlist = () => new Promise(resolve => { finish = resolve; });
  const adding = integration.handlePlexWatchlistClick();
  await integration.updateStatus();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, 'Adding to Plex…');
  finish({already:false});
  await adding;
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, 'Added to Plex ✓');
});

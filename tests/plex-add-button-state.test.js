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

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadIntegration } = require('./helpers/integration');

test('actual flyout setup is idempotent through collapse, expansion and cleanup', async t => {
  const page = loadIntegration(); t.after(() => page.window.close());
  const integration = new page.window.BaseIntegration('Probe', { uiTheme: 'flyout' });
  integration.mediaData = { title: 'Example', mediaType: 'movie', tmdbId: 1 };
  integration.updateStatus = async () => {};
  for (let i = 0; i < 5; i++) await integration.setupFlyoutUI();
  assert.equal(page.window.document.querySelectorAll('.seerr-flyout').length, 1);
  integration.uiElements.flyout.setExpanded(true);
  await integration.setupFlyoutUI();
  assert.equal(page.window.document.querySelectorAll('.seerr-flyout').length, 1);
  integration.cleanupUI();
  assert.equal(page.window.document.querySelectorAll('.seerr-flyout').length, 0);
  integration.mediaData = { title: 'Next title', mediaType: 'movie', tmdbId: 2 };
  await integration.setupFlyoutUI();
  assert.equal(page.window.document.querySelectorAll('.seerr-flyout').length, 1);
  integration.destroy();
});

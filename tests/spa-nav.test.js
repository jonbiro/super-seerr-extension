const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadIntegration } = require('./helpers/integration');

test('production navigation replaces media without duplicating flyouts or retaining old actions', async t => {
  const page = loadIntegration(); t.after(() => page.window.close());
  const integration = new page.window.BaseIntegration('Probe', { uiTheme: 'flyout' });
  integration.updateStatus = async () => {};
  integration.extractMediaData = async () => ({ title: page.window.location.pathname, mediaType: 'movie', tmdbId: 1 });
  for (let i = 0; i < 10; i++) {
    page.window.history.pushState({}, '', `/title/tt${1000 + i}/`);
    await integration.handleNavigationChange();
    assert.equal(page.window.document.querySelectorAll('.seerr-flyout').length, 1);
    assert.equal(integration.mediaData.title, `/title/tt${1000 + i}/`);
    assert.equal(page.window.document.querySelector('.seerr-title').textContent, `/title/tt${1000 + i}/`);
  }
  integration.destroy();
  assert.equal(page.window.document.querySelectorAll('.seerr-flyout').length, 0);
});

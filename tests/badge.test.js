const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadIntegration } = require('./helpers/integration');

test('real library badge remains unique and can be removed and restored', t => {
  const page = loadIntegration(); t.after(() => page.window.close());
  const ui = new page.window.UIComponents();
  const container = page.window.document.createElement('div');
  container.innerHTML = '<span class="seerr-title">Example</span>';
  page.window.document.body.append(container);
  for (let i = 0; i < 10; i++) ui.showInLibraryBadge(container);
  assert.equal(container.querySelectorAll('#seerr-in-library-badge').length, 1);
  assert.match(container.textContent, /In Library/);
  ui.hideInLibraryBadge(container); ui.hideInLibraryBadge(container);
  assert.equal(container.querySelectorAll('#seerr-in-library-badge').length, 0);
  ui.showInLibraryBadge(container);
  assert.equal(container.querySelectorAll('#seerr-in-library-badge').length, 1);
});

test('production status updates show the library badge only for available media', async t => {
  const page = loadIntegration(); t.after(() => page.window.close());
  const integration = new page.window.BaseIntegration('Probe', { uiTheme: 'flyout' });
  integration.mediaData = { title: 'Example', mediaType: 'movie', tmdbId: 1 };
  let status = 'available_watch';
  integration.client.getMediaStatus = async () => ({ status, buttonClass: 'request' });
  await integration.setupFlyoutUI();
  for (const next of ['available_watch', 'pending', 'available_watch', 'error', 'available']) {
    status = next; await integration.updateStatus();
    assert.equal(page.window.document.querySelectorAll('#seerr-in-library-badge').length, next === 'available_watch' ? 1 : 0);
  }
  integration.destroy();
});

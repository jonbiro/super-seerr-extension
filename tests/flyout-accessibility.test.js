const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadIntegration } = require('./helpers/integration');

test('flyout exposes disclosure state, focus, Escape and inert collapsed content', t => {
  const { window } = loadIntegration(); t.after(() => window.close());
  const ui = new window.UIComponents({ siteName: 'Probe' });
  const { flyout, tab, panel } = ui.createFlyout();
  ui.createFlyoutContent({ title: 'Example', mediaType: 'movie' }, panel);
  window.document.body.appendChild(flyout);
  assert.equal(tab.tagName, 'BUTTON'); assert.equal(tab.type, 'button');
  assert.equal(tab.getAttribute('aria-controls'), panel.id);
  assert.equal(tab.getAttribute('aria-expanded'), 'false'); assert.equal(panel.hasAttribute('inert'), true);
  tab.click();
  assert.equal(tab.getAttribute('aria-expanded'), 'true'); assert.equal(panel.hasAttribute('inert'), false);
  assert.equal(window.document.activeElement, panel);
  panel.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(tab.getAttribute('aria-expanded'), 'false'); assert.equal(panel.getAttribute('aria-hidden'), 'true');
  assert.equal(window.document.activeElement, tab);
  tab.click(); panel.querySelector('.seerr-panel-close').click();
  assert.equal(window.document.activeElement, tab);
  assert.equal(panel.querySelector('.seerr-status-text').getAttribute('role'), 'status');
});

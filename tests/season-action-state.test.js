const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadIntegration } = require('./helpers/integration');
function fixture(t) {
  const page = loadIntegration(); t.after(() => page.window.close());
  const ui = new page.window.UIComponents();
  const panel = page.window.document.createElement('div'); page.window.document.body.append(panel);
  const elements = ui.createFlyoutContent({ title: 'Series', mediaType: 'tv' }, panel);
  return { ui, elements };
}
test('a season action starts hidden and disabled until status is known', t => {
  const { elements } = fixture(t);
  assert.equal(elements.seasonButton.style.display, 'none');
  assert.equal(elements.seasonButton.disabled, true);
});
test('loading, blocked, unknown and title/status recovery states cannot offer season selection', t => {
  const { ui, elements } = fixture(t);
  for (const state of [
    { status: 'loading', disabled: true }, { status: 'error', action: 'retryStatus' },
    { status: 'unmatched', action: 'choose' }, { status: 'blocklisted', disabled: true },
    { status: 'unknown' }, { status: 'available', action: 'choose' }
  ]) {
    ui.updateFlyoutStatus(elements, { status: 'available', buttonClass: 'request' });
    ui.updateFlyoutStatus(elements, state);
    assert.equal(elements.seasonButton.style.display, 'none', state.status);
    assert.equal(elements.seasonButton.disabled, true, state.status);
  }
});
test('known TV states retain season selection even when the main request is pending or available to watch', t => {
  const { ui, elements } = fixture(t);
  for (const status of ['available', 'available_watch', 'partial', 'pending', 'requested', 'downloading', 'declined', 'failed']) {
    ui.updateFlyoutStatus(elements, { status: 'loading', disabled: true });
    ui.updateFlyoutStatus(elements, { status });
    assert.equal(elements.seasonButton.style.display, 'flex', status);
    assert.equal(elements.seasonButton.disabled, false, status);
  }
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadIntegration } = require('./helpers/integration');

test('production debug namespace preserves other sites and reads current media', t => {
  const page = loadIntegration(); t.after(() => page.window.close());
  const first = new page.window.BaseIntegration('First');
  first.setupDebugFunctions();
  const retained = page.window.seerr_debug.first;
  const second = new page.window.BaseIntegration('Second');
  second.setupDebugFunctions();
  assert.equal(page.window.seerr_debug.first, retained);
  assert.equal(page.window.jellyseerr_debug, undefined);
  second.mediaData = { title: 'New route' };
  assert.equal(page.window.seerr_debug.second.mediaData.title, 'New route');
  let called = 0; second.updateStatus = () => called++;
  page.window.seerr_debug.second.updateStatus();
  assert.equal(called, 1);
});

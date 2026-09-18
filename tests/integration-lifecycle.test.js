// BaseIntegration polls for SPA navigation every second and patches history.
// destroy() existed but nothing called it, so those outlived the page on all
// seven supported sites.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadIntegration } = require('./helpers/integration');

function makeIntegration(fixture) {
  const { window } = fixture;
  class Probe extends window.BaseIntegration {
    constructor() { super('Probe', { retryDelay: 100000 }); this.navigations = 0; }
    async extractMediaData() { return null; }
    async handleNavigationChange() { this.navigations++; }
  }
  return new Probe();
}

test('the navigation poller is released when the page goes away', async t => {
  const fixture = loadIntegration(); t.after(() => fixture.dom.window.close());
  const integration = makeIntegration(fixture);
  await integration.init();
  assert.equal(fixture.liveTimers(), 1, 'one polling interval while the page is live');

  fixture.window.dispatchEvent(new fixture.window.Event('pagehide'));
  assert.equal(fixture.liveTimers(), 0, 'pagehide must release the interval');
});

test('a restored page re-arms the poller exactly once', async t => {
  const fixture = loadIntegration(); t.after(() => fixture.dom.window.close());
  const integration = makeIntegration(fixture);
  await integration.init();

  fixture.window.dispatchEvent(new fixture.window.Event('pagehide'));
  fixture.window.dispatchEvent(new fixture.window.Event('pageshow'));
  assert.equal(fixture.liveTimers(), 1, 'restored pages poll again');

  fixture.window.dispatchEvent(new fixture.window.Event('pageshow'));
  assert.equal(fixture.liveTimers(), 1, 'a repeated pageshow must not stack intervals');
});

test('destroy releases the timer, the listeners and the history patch', async t => {
  const fixture = loadIntegration(); t.after(() => fixture.dom.window.close());
  const { window } = fixture;
  const pristinePushState = window.history.pushState;
  const integration = makeIntegration(fixture);
  await integration.init();
  assert.notEqual(window.history.pushState, pristinePushState, 'history should be patched while live');

  integration.destroy();
  assert.equal(fixture.liveTimers(), 0);
  assert.equal(window.history.pushState, pristinePushState, 'history should be restored');

  // A destroyed instance must not resurrect itself on a later page event.
  window.dispatchEvent(new window.Event('pageshow'));
  assert.equal(fixture.liveTimers(), 0);
});

test('a second instance still gets navigation detection when history is already patched', async t => {
  const fixture = loadIntegration(); t.after(() => fixture.dom.window.close());
  const first = makeIntegration(fixture);
  await first.init();
  const second = makeIntegration(fixture);
  await second.init();

  // The old early-return skipped the popstate listener and the poller for
  // every instance after the first, leaving it blind to navigation.
  assert.equal(fixture.liveTimers(), 2, 'each instance polls for itself');
  assert.ok(second._popstateListener, 'the second instance still listens for popstate');

  first.destroy();
  second.destroy();
  assert.equal(fixture.liveTimers(), 0);
});

test('navigating mid-request does not wedge the new page button shut', async t => {
  const fixture = loadIntegration(); t.after(() => fixture.dom.window.close());
  const integration = makeIntegration(fixture);
  await integration.init();

  // A request started on the old page is still in flight when navigation
  // cleans up. The flag belongs to that attempt, not to the new page.
  integration._requestInFlight = true;
  integration.cleanupUI();
  assert.equal(integration._requestInFlight, false, 'cleanup releases the in-flight guard');
});

test('a blocked watch popup warns instead of claiming success', async t => {
  const fixture = loadIntegration(); t.after(() => fixture.dom.window.close());
  const integration = makeIntegration(fixture);
  integration.mediaData = { title: 'Dune', mediaType: 'movie', tmdbId: 438631 };
  integration.currentStatusData = { status: 'available_watch', buttonText: 'Watch', buttonClass: 'watch' };
  fixture.window.open = () => null; // strict popup blocker

  await integration.openMediaServer('https://media.example/watch/1');
  let warning = null;
  for (let i = 0; i < 50 && !warning; i++) {
    await new Promise(resolve => setTimeout(resolve, 20));
    warning = [...fixture.window.document.querySelectorAll('.seerr-notification')]
      .find(note => note.textContent.includes('Popup Blocked'));
  }
  assert.ok(warning, 'blocking must surface, not report an opening that never happened');
  assert.ok(![...fixture.window.document.querySelectorAll('.seerr-notification')]
    .some(note => note.textContent.includes('Opening media server')), 'no false success');
});

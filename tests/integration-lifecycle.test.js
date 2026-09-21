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

test('destroyed instances run no retries and build no UI', async t => {
  const fixture = loadIntegration(); t.after(() => fixture.dom.window.close());
  const { window } = fixture;
  let extractions = 0;
  class Eager extends window.BaseIntegration {
    constructor() { super('Eager', { retryDelay: 40 }); }
    async extractMediaData() { extractions++; return { title: 'Dune', year: 2021, mediaType: 'movie' }; }
  }
  const integration = new Eager();
  await integration.init();
  assert.equal(extractions, 1, 'init extracts once');
  assert.equal(integration._pendingRetries.size, 1, 'the dynamic-content retry is tracked');

  integration.destroy();
  assert.equal(integration._pendingRetries.size, 0, 'destroy clears pending retries');
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(extractions, 1, 'no retry extraction runs after destroy');
  assert.equal(window.document.querySelector('.seerr-flyout'), null, 'no flyout is resurrected');
});

test('navigation that dies mid-flight builds nothing', async t => {
  const fixture = loadIntegration(); t.after(() => fixture.dom.window.close());
  const { window } = fixture;
  class Slow extends window.BaseIntegration {
    constructor() { super('Slow', { retryDelay: 100000 }); }
    async extractMediaData() { return { title: 'Dune', year: 2021, mediaType: 'movie' }; }
  }
  const integration = new Slow();
  await integration.init();
  integration.cleanupUI();
  assert.equal(window.document.querySelector('.seerr-flyout'), null, 'precondition: no flyout yet');

  const navigating = integration.handleNavigationChange();
  integration.destroy();
  await navigating;
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(window.document.querySelector('.seerr-flyout'), null, 'a dead navigation must not build UI');
});

test('navigation replaces an expanded flyout with the new title', async t => {
  const fixture = loadIntegration({ html: '<h1>Old title</h1>' });
  t.after(() => fixture.window.close());
  class Navigating extends fixture.window.BaseIntegration {
    constructor() { super('Navigation', { uiTheme: 'flyout', retryDelay: 100000 }); }
    async extractMediaData() { return { title: fixture.window.document.querySelector('h1').textContent, mediaType: 'movie' }; }
    async updateStatus() {}
  }
  const integration = new Navigating();
  await integration.extractAndSetup();
  const oldFlyout = integration.uiElements.flyout;
  oldFlyout.classList.add('expanded');
  fixture.window.history.replaceState({}, '', '/title/tt9999999/');
  fixture.window.document.querySelector('h1').textContent = 'New title';
  const navigating = integration.handleNavigationChange();
  assert.equal(oldFlyout.isConnected, false, 'the old title must stop being actionable immediately');
  await navigating;
  assert.equal(integration.mediaData.title, 'New title');
  assert.equal(fixture.window.document.querySelectorAll('.seerr-flyout').length, 1);
  assert.ok(integration.uiElements.panel.textContent.includes('New title'));
  integration.destroy();
});

test('destroy removes an expanded flyout', async t => {
  const fixture = loadIntegration(); t.after(() => fixture.window.close());
  const integration = new fixture.window.BaseIntegration('Probe', { uiTheme: 'flyout' });
  integration.mediaData = { title: 'Example', mediaType: 'movie' };
  integration.updateStatus = async () => {};
  await integration.setupUI();
  const flyout = integration.uiElements.flyout;
  flyout.classList.add('expanded');
  integration.destroy();
  assert.equal(flyout.isConnected, false);
});

test('an old extraction cannot replace a newer page identity', async t => {
  const fixture = loadIntegration(); t.after(() => fixture.window.close());
  const integration = new fixture.window.BaseIntegration('Probe');
  let finishOld;
  integration.extractMediaData = () => new Promise(resolve => { finishOld = resolve; });
  const titles = [];
  integration.setupUI = async () => { titles.push(integration.mediaData.title); };
  const old = integration.extractAndSetup();
  fixture.window.history.replaceState({}, '', '/title/tt9999999/');
  integration.extractMediaData = async () => ({ title: 'New title', mediaType: 'movie' });
  await integration.extractAndSetup();
  finishOld({ title: 'Old title', mediaType: 'movie' });
  await old;
  assert.equal(integration.mediaData.title, 'New title');
  assert.deepEqual(titles, ['New title']);
});

test('a newly discovered IMDb identity replaces an expanded same-page flyout', async t => {
  const fixture = loadIntegration(); t.after(() => fixture.window.close());
  const integration = new fixture.window.BaseIntegration('Probe', { uiTheme: 'flyout' });
  t.after(() => integration.destroy());
  let imdbId = null;
  integration.extractMediaData = async () => ({ title: 'Example', mediaType: 'movie', year: 2020, imdbId });
  integration.updateStatus = async () => {};
  await integration.extractAndSetup();
  const original = integration.uiElements.flyout;
  original.classList.add('expanded');
  await integration.extractAndSetup();
  assert.equal(integration.uiElements.flyout, original, 'unchanged identity preserves the open panel');
  imdbId = 'tt1234567';
  await integration.extractAndSetup();
  assert.equal(integration.mediaData.imdbId, imdbId);
  assert.equal(original.isConnected, false, 'the old action identity is removed');
  assert.equal(fixture.window.document.querySelectorAll('.seerr-flyout').length, 1);
});

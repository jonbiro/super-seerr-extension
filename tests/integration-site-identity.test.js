const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadIntegration } = require('./helpers/integration');
const original = { title: 'The Thing', mediaType: 'movie', year: null };
const choices = {
  Home: { title: 'The Thing', mediaType: 'movie', year: 1982, tmdbId: 910 },
  Family: { title: 'The Thing', mediaType: 'movie', year: 2011, tmdbId: 911 }
};

function probe(t, { site = 'Home', switchAfterMatch = false } = {}) {
  let active = site;
  const messages = [];
  const fixture = loadIntegration({ sendMessage: async message => {
    messages.push({ ...message, active });
    if (message.action === 'getConfigState') return { success: true, data: {
      connectionToken: active, serverUrl: `https://${active.toLowerCase()}.example`, plexConfigured: false
    } };
    if (message.action === 'getSavedTitleCorrection') {
      if (message.connectionToken !== undefined && message.connectionToken !== active) return { success: false, error: 'Site changed' };
      const data = choices[active];
      if (switchAfterMatch && active === 'Home') active = 'Family';
      return { success: true, data };
    }
    if (message.action === 'getMediaStatus') return { success: true, data: {
      status: 'available', buttonText: 'Request', buttonClass: 'request', action: 'request'
    } };
    return { success: true };
  } });
  const integration = new fixture.window.BaseIntegration('Probe', { uiTheme: 'flyout', retryDelay: 100000 });
  integration.extractMediaData = async () => ({ ...original });
  t.after(() => { integration.destroy(); fixture.window.close(); });
  return { integration, fixture, messages, switchTo: site => { active = site; } };
}

test('a discovery panel loads the new site saved choice instead of using its previous token', async t => {
  const p = probe(t);
  await p.integration.extractAndSetup();
  assert.equal(p.integration.mediaData.tmdbId, 910);
  p.switchTo('Family');
  p.integration.cleanupUI();
  await p.integration.extractAndSetup();
  assert.equal(p.integration.mediaData.tmdbId, 911);
  assert.equal(p.integration.client.connectionToken, 'Family');
  const match = p.messages.filter(m => m.action === 'getSavedTitleCorrection').at(-1);
  assert.equal(match.connectionToken, 'Family');
  assert.match(p.integration.uiElements.panel.textContent, /2011/);
});

test('a switch after the saved-match reply cannot retarget that identity to another site', async t => {
  const p = probe(t, { switchAfterMatch: true });
  await p.integration.extractAndSetup();
  assert.equal(p.integration.mediaData.tmdbId, 911);
  const statuses = p.messages.filter(m => m.action === 'getMediaStatus');
  assert.ok(statuses.length > 0);
  assert.ok(statuses.every(m => m.active === 'Family' && m.connectionToken === 'Family' && m.data.tmdbId === 911));
});

test('an expanded panel is rebuilt when its site changes even with unchanged page identity', async t => {
  const p = probe(t);
  // Identical metadata can still have different request/availability state.
  p.integration.client.sendMessage = async message => message.action === 'getSavedTitleCorrection'
    ? { success: true, data: null }
    : p.fixture.window.chrome.runtime.sendMessage(message);
  await p.integration.extractAndSetup();
  const old = p.integration.uiElements.flyout;
  old.setExpanded(true);
  p.switchTo('Family');
  await p.integration.extractAndSetup();
  assert.notEqual(p.integration.uiElements.flyout, old);
  assert.equal(old.isConnected, false);
  assert.equal(p.integration.client.connectionToken, 'Family');
  assert.match(p.integration.uiElements.panel.textContent, /family\.example/);
});

test('late configuration from an older extraction cannot request or apply an old saved choice', async t => {
  const p = probe(t);
  let release;
  const send = p.integration.client.sendMessage.bind(p.integration.client);
  let first = true;
  p.integration.client.sendMessage = message => {
    if (first && message.action === 'getConfigState') {
      first = false;
      return new Promise(resolve => { release = resolve; });
    }
    return send(message);
  };
  const old = p.integration.extractAndSetup();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof release, 'function');
  p.switchTo('Family'); p.integration.cleanupUI();
  await p.integration.extractAndSetup();
  release({ success: true, data: { connectionToken: 'Home', serverUrl: 'https://home.example' } });
  await old;
  assert.equal(p.integration.mediaData.tmdbId, 911);
  assert.equal(p.integration.client.connectionToken, 'Family');
  assert.equal(p.messages.filter(m => m.action === 'getSavedTitleCorrection').length, 1);
});

test('an unchanged extraction preserves an expanded panel and its connection', async t => {
  const p = probe(t);
  await p.integration.extractAndSetup();
  const flyout = p.integration.uiElements.flyout;
  flyout.setExpanded(true);
  await p.integration.extractAndSetup();
  assert.equal(p.integration.uiElements.flyout, flyout);
  assert.equal(flyout.classList.contains('expanded'), true);
  assert.equal(p.integration.client.connectionToken, 'Home');
});

test('configuration failure keeps the old token scoped and Retry status recovers the new site identity', async t => {
  const p = probe(t);
  p.integration.error = () => {};
  await p.integration.extractAndSetup();
  const send = p.integration.client.sendMessage.bind(p.integration.client);
  p.switchTo('Family'); p.integration.cleanupUI();
  p.integration.client.sendMessage = message => message.action === 'getConfigState'
    ? Promise.resolve({ success: false, error: 'Configuration temporarily unavailable' }) : send(message);
  await p.integration.extractAndSetup();
  assert.equal(p.integration.currentStatusData.action, 'retryStatus');
  assert.equal(p.integration.client.connectionToken, 'Home');
  assert.ok(!p.messages.some(m => m.active === 'Family' && m.action === 'getMediaStatus'));
  p.integration.client.sendMessage = send;
  await p.integration.handleRequest();
  assert.equal(p.integration.mediaData.tmdbId, 911);
  assert.equal(p.integration.client.connectionToken, 'Family');
  assert.equal(p.integration.currentStatusData.action, 'request');
});

test('a late saved-choice reply cannot replace the new site panel or token', async t => {
  const p = probe(t);
  const send = p.integration.client.sendMessage.bind(p.integration.client);
  let release, first = true;
  p.integration.client.sendMessage = message => {
    if (first && message.action === 'getSavedTitleCorrection') {
      first = false;
      return new Promise(resolve => { release = resolve; });
    }
    return send(message);
  };
  const old = p.integration.extractAndSetup();
  await new Promise(resolve => setImmediate(resolve));
  p.switchTo('Family'); p.integration.cleanupUI();
  await p.integration.extractAndSetup();
  const current = p.integration.uiElements.flyout;
  release({ success: true, data: choices.Home }); await old;
  assert.equal(p.integration.mediaData.tmdbId, 911);
  assert.equal(p.integration.uiElements.flyout, current);
  assert.equal(p.integration.client.connectionToken, 'Family');
});

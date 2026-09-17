// The popup showed one description in every state, so a user who had already
// added an API key was still being told what an API key would let them do.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };

async function openPopup({ synced = {}, local = {}, reply = { success: true, data: { user: 'yoni' } } } = {}) {
  const dom = new JSDOM(fs.readFileSync('src/popup/popup.html', 'utf8'),
    { url: 'chrome-extension://test/popup.html', runScripts: 'outside-only' });
  const { window } = dom;
  window.chrome = {
    storage: { sync: { get: async () => ({ ...synced }) }, local: { get: async () => ({ ...local }) } },
    runtime: { sendMessage: async () => reply, openOptionsPage: async () => {} }
  };
  window.eval(fs.readFileSync('src/popup/popup.js', 'utf8'));
  await flush();
  return { dom, window };
}

const shown = window => {
  const block = window.document.getElementById('configuredState');
  return { heading: block.querySelector('h3').textContent, body: block.querySelector('p').textContent };
};

test('a connected user is not told what an API key would do', async t => {
  const ctx = await openPopup({ synced: { seerrUrl: 'https://seerr.example' }, local: { seerrApiKey: 'k' } });
  t.after(() => ctx.dom.window.close());

  const { body } = shown(ctx.window);
  assert.doesNotMatch(body, /with an api key/i, `already has one, but was told: "${body}"`);
});

test('a ratings-only user is told what an API key would add', async t => {
  const ctx = await openPopup({ synced: { seerrUrl: 'https://seerr.example' }, local: {} });
  t.after(() => ctx.dom.window.close());

  const { body } = shown(ctx.window);
  assert.match(body, /api key/i, 'this is the state where that advice applies');
});

test('the two states read differently', async t => {
  const withKey = await openPopup({ synced: { seerrUrl: 'https://seerr.example' }, local: { seerrApiKey: 'k' } });
  t.after(() => withKey.dom.window.close());
  const without = await openPopup({ synced: { seerrUrl: 'https://seerr.example' }, local: {} });
  t.after(() => without.dom.window.close());

  assert.notEqual(shown(withKey.window).body, shown(without.window).body,
    'one description cannot serve both states');
});

test('the heading says what you can do, not that software is running', async t => {
  for (const local of [{ seerrApiKey: 'k' }, {}]) {
    const ctx = await openPopup({ synced: { seerrUrl: 'https://seerr.example' }, local });
    t.after(() => ctx.dom.window.close());
    assert.doesNotMatch(shown(ctx.window).heading, /extension/i,
      '"Extension Active" describes the software, not the reader');
  }
});

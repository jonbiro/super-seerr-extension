const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

async function popup(data) {
  const dom = new JSDOM(fs.readFileSync('src/popup/popup.html', 'utf8'), { runScripts: 'outside-only' });
  const links = [];
  const listeners = [];
  dom.window.chrome = { runtime: { onMessage: { addListener: listener => listeners.push(listener) }, sendMessage: async () => ({ success: true, data }), getURL: path => `chrome-extension://test/${path}` }, tabs: { create: value => links.push(value) } };
  dom.window.eval(fs.readFileSync('src/popup/popup.js', 'utf8') + '\nwindow.PopupManager = PopupManager;');
  await new Promise(resolve => setImmediate(resolve));
  return { dom, document: dom.window.document, links, notify: message => listeners.forEach(listener => listener(message)) };
}
const row = (state, message, fix) => ({ state, message, fix });

test('popup renders independent connection checks and links to the exact repair setting', async () => {
  const { dom, document, links } = await popup({ serverUrl: 'http://localhost:5055', checks: {
    seerr: row('ok', 'Reachable'), permission: row('ok', 'Granted'),
    apiKey: row('error', 'Key rejected', 'apiKey'), plex: row('warning', 'No token', 'plexToken')
  } });
  assert.equal(document.getElementById('serverUrl').textContent, 'localhost:5055');
  assert.equal(document.querySelectorAll('.diagnostic-row').length, 4);
  assert.match(document.getElementById('diagnosticChecks').textContent, /API key: Needs fixing/);
  document.querySelector('.diagnostic-row button').click();
  assert.equal(links[0].url, 'chrome-extension://test/src/options/options.html#apiKey');
  assert.match(document.querySelector('.status-text').textContent, /attention/);
  dom.window.close();
});

test('popup does not claim ratings are working without server permission', async () => {
  const { dom, document } = await popup({ serverUrl: 'https://seerr.example', checks: {
    seerr: row('warning', 'Grant access'), permission: row('error', 'Missing permission', 'permissionWarning'),
    apiKey: row('warning', 'No key', 'apiKey'), plex: row('warning', 'No token', 'plexToken')
  } });
  assert.equal(document.getElementById('configuredHeading').textContent, 'Check your connection');
  dom.window.close();
});

test('popup ratings-only and request-ready states reflect verified checks', async () => {
  for (const [state, expected] of [['warning', 'Ratings-only mode'], ['ok', 'Ready to request']]) {
    const { dom, document } = await popup({ serverUrl: 'https://seerr.example', checks: {
      seerr: row('ok', 'Reachable'), permission: row('ok', 'Granted'), apiKey: row(state, 'Key state'), plex: row('warning', 'Optional')
    } });
    assert.equal(document.querySelector('.status-text').textContent, expected);
    dom.window.close();
  }
});

test('popup ignores stale checks and clears obsolete diagnostic details on failure', async () => {
  const { dom, document } = await popup({ serverUrl: null, checks: {
    seerr: row('warning', 'Old'), permission: row('warning', 'Old'), apiKey: row('warning', 'Old'), plex: row('warning', 'Old')
  } });
  const pending = [];
  dom.window.chrome.runtime.sendMessage = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
  const manager = new dom.window.PopupManager();
  const latest = manager.checkStatus();
  pending[1].resolve({ success: true, data: { serverUrl: 'https://new.example', checks: {
    seerr: row('ok', 'New'), permission: row('ok', 'New'), apiKey: row('ok', 'New'), plex: row('ok', 'New')
  } } });
  await latest;
  pending[0].reject(new Error('Old failure'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(document.getElementById('serverUrl').textContent, 'new.example');
  assert.equal(document.querySelector('.status-text').textContent, 'Ready to request');
  const failed = manager.checkStatus();
  pending[2].reject(new Error('Offline'));
  await failed;
  assert.equal(document.querySelectorAll('.diagnostic-row').length, 0);
  assert.equal(document.getElementById('errorMessage').textContent, 'Offline');
  dom.window.close();
});

test('worker configuration signals recheck the popup and ignore obsolete diagnostic replies', async () => {
  const f = await popup({ serverUrl: 'https://seerr.example', checks: {
    seerr: row('ok', 'Reachable'), permission: row('ok', 'Granted'), apiKey: row('warning', 'No key'), plex: row('warning', 'Optional')
  } });
  try {
    const pending = [];
    f.dom.window.chrome.runtime.sendMessage = () => new Promise(resolve => pending.push(resolve));
    f.notify({ action: 'publicRatingsChanged' });
    assert.equal(pending.length, 0, 'ratings persistence does not trigger connection checks');
    f.notify({ action: 'seerrConfigChanged' });
    f.notify({ action: 'seerrConfigChanged' });
    assert.equal(pending.length, 2);
    const checks = state => ({ seerr: row('ok', 'Reachable'), permission: row('ok', 'Granted'),
      apiKey: row(state, 'Key state'), plex: row('warning', 'Optional') });
    pending[1]({ success: true, data: { serverUrl: 'https://seerr.example', checks: checks('ok') } });
    await new Promise(resolve => setImmediate(resolve));
    pending[0]({ success: true, data: { serverUrl: 'https://seerr.example', checks: checks('warning') } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.document.querySelector('.status-text').textContent, 'Ready to request');
  } finally { f.dom.window.close(); }
});

for (const state of ['warning', 'error']) test(`a saved but ${state === 'warning' ? 'unverified' : 'rejected'} API key is not described as missing`, async () => {
  const { dom, document } = await popup({ serverUrl: 'https://seerr.example', apiKeyConfigured: true, checks: {
    seerr: row('ok', 'Reachable'), permission: row('ok', 'Granted'),
    apiKey: row(state, 'Saved key could not be verified', 'apiKey'), plex: row('warning', 'Optional')
  } });
  try {
    assert.equal(document.querySelector('.status-text').textContent, 'Connection needs attention');
    assert.equal(document.getElementById('configuredHeading').textContent, 'Check your API key');
    assert.doesNotMatch(document.getElementById('configuredDetail').textContent, /add an api key/i);
    assert.match(document.getElementById('configuredDetail').textContent, /saved API key.*not verified/i);
  } finally { dom.window.close(); }
});

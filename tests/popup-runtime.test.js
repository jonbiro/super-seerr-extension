const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

async function popup(data) {
  const dom = new JSDOM(fs.readFileSync('src/popup/popup.html', 'utf8'), { runScripts: 'outside-only' });
  const links = [];
  dom.window.chrome = { runtime: { sendMessage: async () => ({ success: true, data }), getURL: path => `chrome-extension://test/${path}` }, tabs: { create: value => links.push(value) } };
  dom.window.eval(fs.readFileSync('src/popup/popup.js', 'utf8') + '\nwindow.PopupManager = PopupManager;');
  await new Promise(resolve => setImmediate(resolve));
  return { dom, document: dom.window.document, links };
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

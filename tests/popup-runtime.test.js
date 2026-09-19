const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('popup distinguishes ratings-only, unconfigured and request-enabled modes', async () => {
  for (const [settings, expected, expectedCalls] of [
    [{}, 'Set your Seerr server URL', 0],
    [{ seerrUrl: 'https://seerr.example' }, 'Ratings-only mode', 0],
    [{ seerrUrl: 'https://seerr.example', seerrApiKey: 'test-key' }, 'Connected as Tester', 1]
  ]) {
    const nodes = new Map();
    function getNode(id) {
      if (!nodes.has(id)) {
        const classes = new Set(['hidden']);
        nodes.set(id, { textContent: '', addEventListener() {}, classList: { add: name => classes.add(name), remove: (...names) => names.forEach(name => classes.delete(name)), contains: name => classes.has(name) }, querySelector: () => getNode(`${id}-text`) });
      }
      return nodes.get(id);
    }
    let calls = 0;
    const context = vm.createContext({
      URL, console, document: { readyState: 'loading', getElementById: getNode, addEventListener() {} },
      chrome: {
        // The URL syncs; the API key is device-local.
        storage: {
          sync: { get: async () => ({ seerrUrl: settings.seerrUrl }) },
          local: { get: async () => (settings.seerrApiKey === undefined ? {} : { seerrApiKey: settings.seerrApiKey }) }
        },
        runtime: { sendMessage: async () => { calls++; return { success: true, data: { user: 'Tester' } }; } }
      }
    });
    vm.runInContext(fs.readFileSync('src/popup/popup.js', 'utf8') + '\nglobalThis.manager = new PopupManager();', context);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(getNode('statusIndicator-text').textContent, expected);
    assert.equal(calls, expectedCalls);
    assert.equal(getNode('testConnection').classList.contains('hidden'), !settings.seerrApiKey);
  }
});

test('popup keeps the port when shortening the server URL', async () => {
  const stub = () => ({
    textContent: '',
    addEventListener() {},
    classList: { add() {}, remove() {}, contains: () => true },
    querySelector: () => stub()
  });
  const context = vm.createContext({
    URL, console,
    document: {
      readyState: 'complete',
      getElementById: () => stub(),
      addEventListener() {},
      querySelector: () => null
    },
    chrome: {
      storage: { sync: { get: async () => ({}) }, local: { get: async () => ({}) } },
      runtime: { sendMessage: async () => ({ success: false }) }
    }
  });
  vm.runInContext(fs.readFileSync('src/popup/popup.js', 'utf8') + '\nglobalThis.manager = new PopupManager();', context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.manager.formatServerUrl('http://127.0.0.1:5055'), '127.0.0.1:5055');
  assert.equal(context.manager.formatServerUrl('https://seerr.example'), 'seerr.example');
  assert.equal(context.manager.formatServerUrl('not a url'), 'not a url');
});

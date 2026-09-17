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
      chrome: { storage: { sync: { get: async () => settings } }, runtime: { sendMessage: async () => { calls++; return { success: true, data: { user: 'Tester' } }; } } }
    });
    vm.runInContext(fs.readFileSync('src/popup/popup.js', 'utf8') + '\nglobalThis.manager = new PopupManager();', context);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(getNode('statusIndicator-text').textContent, expected);
    assert.equal(calls, expectedCalls);
    assert.equal(getNode('testConnection').classList.contains('hidden'), !settings.seerrApiKey);
  }
});

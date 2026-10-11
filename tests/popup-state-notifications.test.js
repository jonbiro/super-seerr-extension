const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker } = require('./helpers/worker');
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };

test('credential reload signals extension pages only after the new pair is in memory', async () => {
  const w = loadWorker({ get: async () => ({ seerrUrl: 'https://seerr.example' }), local: { seerrApiKey: 'old-key' } });
  await w.ready;
  const signals = [];
  w.context.chrome.runtime.sendMessage = async message => { signals.push({ message, key: w.api.apiKey, plex: w.api.plexToken }); };
  let release;
  const original = w.context.chrome.storage.local.get;
  w.context.chrome.storage.local.get = async keys => {
    await new Promise(resolve => { release = resolve; });
    return original(keys);
  };
  w.localStore.seerrApiKey = 'new-key'; w.localStore.plexToken = 'new-plex';
  w.listeners.storage({ seerrApiKey: { newValue: 'new-key' }, plexToken: { newValue: 'new-plex' } }, 'local');
  await settle();
  assert.equal(signals.length, 0, 'popups must not race the settings read');
  release(); await settle();
  assert.equal(signals.length, 1);
  assert.equal(signals[0].key, 'new-key');
  assert.equal(signals[0].plex, 'new-plex');
  assert.equal(JSON.stringify(signals[0].message), '{"action":"seerrConfigChanged"}', 'the signal contains no credentials');
});

for (const event of ['permissionAdded', 'permissionRemoved']) test(`${event} refreshes open popup diagnostics`, async () => {
  const w = loadWorker(); await w.ready;
  const signals = [];
  w.context.chrome.runtime.sendMessage = async message => { signals.push(message); };
  w.listeners[event](); await settle();
  assert.equal(signals.length, 1);
  assert.equal(signals[0].action, 'seerrConfigChanged');
});

test('ratings notifications stay separate from configuration signals and absent popups are harmless', async () => {
  const w = loadWorker(); await w.ready;
  const signals = [];
  w.context.chrome.runtime.sendMessage = async message => { signals.push(message); };
  await w.api.notifyContentState(true);
  await w.api.notifyContentState(false, true);
  assert.equal(signals.length, 0);
  w.context.chrome.runtime.sendMessage = async () => { throw new Error('No receiving extension page'); };
  await w.api.notifyPopupState();
  await w.api.notifyContentState();
});

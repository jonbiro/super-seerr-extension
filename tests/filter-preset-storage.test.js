const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker } = require('./helpers/worker');
const KEY = 'seerrFilterPresetsV1';
const sender = { id: 'test', tab: { id: 1 }, url: 'https://seerr.example/' };
const preset = name => ({ name, sort: 'default', filters: { minCritics: 70 } });

test('concurrent tab writes preserve both presets and ordered deletion', async () => {
  const w = loadWorker(); await w.ready; w.api.baseUrl = sender.url;
  let stored = [];
  w.context.chrome.storage.sync = {
    get: async () => { await new Promise(resolve => setImmediate(resolve)); return { [KEY]: structuredClone(stored) }; },
    set: async value => { await new Promise(resolve => setImmediate(resolve)); stored = structuredClone(value[KEY]); }
  };
  await Promise.all([
    w.api.filterPresetOperation('saveFilterPreset', preset('One'), sender),
    w.api.filterPresetOperation('saveFilterPreset', preset('Two'), { ...sender, tab: { id: 2 } })
  ]);
  assert.deepEqual(stored.map(item => item.name), ['One', 'Two']);
  await Promise.all([
    w.api.filterPresetOperation('deleteFilterPreset', { name: 'One' }, sender),
    w.api.filterPresetOperation('saveFilterPreset', preset('Three'), sender)
  ]);
  assert.deepEqual(stored.map(item => item.name), ['Two', 'Three']);
});

test('failed writes do not poison the queue and untrusted pages cannot change presets', async () => {
  const w = loadWorker(); await w.ready; w.api.baseUrl = sender.url;
  let fail = true, stored = [];
  w.context.chrome.storage.sync = { get: async () => ({ [KEY]: stored }), set: async value => {
    if (fail) throw new Error('Storage unavailable'); stored = value[KEY];
  } };
  await assert.rejects(w.api.filterPresetOperation('saveFilterPreset', preset('One'), sender), /Storage unavailable/);
  fail = false;
  await w.api.filterPresetOperation('saveFilterPreset', preset('Two'), sender);
  assert.equal(stored[0].name, 'Two');
  assert.throws(() => w.api.filterPresetOperation('deleteFilterPreset', { name: 'Two' }, { ...sender, url: 'https://other.example/' }));
  assert.equal(stored.length, 1);
});

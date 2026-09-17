// The API key is a secret: it must end up in device-local storage, must be
// removed from the synced namespace, and must never be readable by the overlay.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loadWorker } = require('./helpers/worker');

test('an existing synced API key is copied to local storage and removed from sync', async () => {
  const worker = loadWorker({ get: async () => ({ seerrUrl: 'https://seerr.example', seerrApiKey: 'secret-key' }) });
  await worker.ready;

  assert.equal(worker.localStore.seerrApiKey, 'secret-key', 'key should be copied to local storage');
  assert.ok(worker.removals.some(keys => keys.includes('seerrApiKey')), 'key should be removed from sync');
  assert.equal(worker.api.apiKey, 'secret-key', 'worker should read the migrated key');
});

test('an intentionally empty API key migrates as an empty string, not as absent', async () => {
  const worker = loadWorker({ get: async () => ({ seerrUrl: 'https://seerr.example', seerrApiKey: '' }) });
  await worker.ready;

  assert.equal(worker.localStore.seerrApiKey, '');
  assert.equal(worker.api.apiKey, '');
});

test('migration never overwrites a key already stored locally', async () => {
  const worker = loadWorker({
    get: async () => ({ seerrUrl: 'https://seerr.example', seerrApiKey: 'stale-synced' }),
    local: { seerrApiKey: 'current-local' }
  });
  await worker.ready;

  assert.equal(worker.localStore.seerrApiKey, 'current-local');
  assert.ok(worker.removals.some(keys => keys.includes('seerrApiKey')), 'the stale synced copy is still cleared');
});

test('migration is a no-op when there was never a synced key', async () => {
  const worker = loadWorker({ get: async () => ({ seerrUrl: 'https://seerr.example' }) });
  await worker.ready;

  assert.equal(worker.localStore.seerrApiKey, undefined);
  assert.ok(!worker.removals.some(keys => keys.includes('seerrApiKey')));
});

test('the worker reports request availability without handing out the key', async () => {
  const worker = loadWorker({ get: async () => ({ seerrUrl: 'https://seerr.example' }), local: { seerrApiKey: 'secret-key' } });
  await worker.ready;

  const response = await new Promise(resolve => worker.api.handleMessage({ action: 'getConfigState' }, {}, resolve));
  assert.equal(response.success, true);
  assert.equal(response.data.apiConfigured, true);
  assert.equal(response.data.serverUrl, 'https://seerr.example');
  assert.ok(!JSON.stringify(response).includes('secret-key'), 'the key must not cross the message boundary');
});

test('the overlay content script never reads the API key from storage', () => {
  const overlay = fs.readFileSync('src/content/seerr-integration.js', 'utf8');
  assert.ok(!overlay.includes('seerrApiKey\''), 'overlay must not request the seerrApiKey storage key');
  assert.ok(overlay.includes('getConfigState'), 'overlay should ask the worker whether requests are available');
});

test('no code outside the migration reads or writes the key in synced storage', () => {
  // The split is easy to undo by habit: storage.sync.get(['seerrUrl',
  // 'seerrApiKey']) reads naturally and would silently start syncing the
  // secret again.
  const sources = {
    'src/background/background.js': 'migration only',
    'src/options/options.js': null,
    'src/popup/popup.js': null,
    'src/content/seerr-integration.js': null
  };

  for (const [file, allowance] of Object.entries(sources)) {
    const text = fs.readFileSync(file, 'utf8');
    const syncCalls = [...text.matchAll(/chrome\.storage\.sync\.(get|set)\(([^)]*)\)/g)]
      .filter(match => match[2].includes('seerrApiKey'));

    if (allowance === null) {
      assert.equal(syncCalls.length, 0, `${file} must not touch seerrApiKey in sync storage`);
    } else {
      // The worker may only read the legacy value in order to migrate it away.
      for (const call of syncCalls) {
        assert.ok(call[1] === 'get', `${file}: sync.set of seerrApiKey is never correct`);
        assert.ok(call[2].includes('jellyseerrApiKey'), `${file}: only the migration read is allowed`);
      }
    }
  }
});

test('the key is removed from synced storage, not merely copied', () => {
  const worker = fs.readFileSync('src/background/background.js', 'utf8');
  assert.ok(worker.includes("chrome.storage.sync.remove(['seerrApiKey'])"), 'migration must clear the synced copy');
});

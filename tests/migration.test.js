const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker } = require('./helpers/worker');

test('real migration preserves the legacy URL, moves secrets locally, and is idempotent', async () => {
  const synced = { jellyseerrUrl: 'https://seerr.example/base', jellyseerrApiKey: 'legacy-key' };
  const worker = loadWorker({ get: async () => ({ ...synced }) });
  await worker.ready;
  for (const update of worker.writes) Object.assign(synced, update);
  for (const keys of worker.removals) for (const key of keys) delete synced[key];
  assert.equal(synced.seerrUrl, 'https://seerr.example/base');
  assert.equal(synced.jellyseerrUrl, undefined);
  assert.equal(synced.jellyseerrApiKey, undefined);
  assert.equal(synced.seerrApiKey, undefined);
  assert.equal(worker.localStore.seerrApiKey, 'legacy-key');
  const restarted = loadWorker({ get: async () => ({ ...synced }), local: worker.localStore });
  await restarted.ready;
  assert.equal(restarted.api.apiKey, 'legacy-key');
  assert.equal(restarted.localWrites.length, 0);
  assert.equal(restarted.writes.length, 0);
  assert.equal(restarted.removals.length, 0);
});

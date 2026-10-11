const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker } = require('./helpers/worker');
const tick = () => new Promise(resolve => setImmediate(resolve));

async function fixture() {
  const worker = loadWorker({ get: async () => ({ seerrUrl: 'https://home.example' }),
    grantedOrigins: ['https://home.example/*', 'https://family.example/*'] });
  await worker.ready;
  worker.registrations.length = 0;
  const api = worker.context.chrome.scripting;
  api.getRegisteredContentScripts = async () => { const snapshot = [...worker.registrations]; await tick(); return snapshot; };
  const register = api.registerContentScripts;
  api.registerContentScripts = async scripts => {
    if (scripts.some(script => worker.registrations.some(existing => existing.id === script.id))) throw new Error('Duplicate script ID');
    await register(scripts);
  };
  return worker;
}

test('concurrent overlay registration updates do not attempt duplicate script IDs', async () => {
  const worker = await fixture();
  const results = await Promise.all([worker.api.syncOverlayRegistration(), worker.api.syncOverlayRegistration()]);
  assert.deepEqual(results, [true, true]);
  assert.equal(worker.registrations.length, 2);
  assert.equal(new Set(worker.registrations.map(script => script.id)).size, 2);
});

test('a queued registration update converges on the newly selected site', async () => {
  const worker = await fixture();
  const first = worker.api.syncOverlayRegistration();
  await Promise.resolve();
  worker.api.baseUrl = 'https://family.example';
  const second = worker.api.syncOverlayRegistration();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(worker.registrations.length, 2);
  for (const script of worker.registrations) assert.equal(script.matches[0], 'https://family.example/*');
});

test('an unconfigured worker does not dereference an absent remembered server name', async () => {
  const worker = loadWorker(); await worker.ready;
  assert.equal(worker.logs.error.some(args => args[0] === 'Error loading Seerr settings:'), false);
  assert.equal(worker.api.mediaServerName, null);
});

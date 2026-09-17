// The Seerr origin is only known at runtime, so the overlay is registered
// dynamically against the saved server once the host permission is granted.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loadWorker } = require('./helpers/worker');

const SEERR = 'https://seerr.example';
const PATTERN = 'https://seerr.example/*';

test('the overlay is registered for the saved origin once permission is granted', async () => {
  const worker = loadWorker({ get: async () => ({ seerrUrl: SEERR }), grantedOrigins: [PATTERN] });
  await worker.ready;

  assert.equal(worker.registrations.length, 1);
  const [script] = worker.registrations;
  assert.deepEqual([...script.matches], [PATTERN]);
  assert.equal(script.id, 'seerr-overlay');
  assert.equal(script.runAt, 'document_idle');
  assert.ok(script.js.includes('src/content/seerr-integration.js'));
  assert.ok(script.css.includes('src/content/seerr-overlay.css'));
});

test('nothing is registered while the host permission is missing', async () => {
  const worker = loadWorker({ get: async () => ({ seerrUrl: SEERR }), grantedOrigins: [] });
  await worker.ready;

  assert.equal(worker.registrations.length, 0);
});

test('the registration follows the server to a new origin instead of accumulating', async () => {
  let url = SEERR;
  const worker = loadWorker({
    get: async () => ({ seerrUrl: url }),
    grantedOrigins: [PATTERN, 'https://moved.example/*']
  });
  await worker.ready;
  assert.deepEqual([...worker.registrations[0].matches], [PATTERN]);

  url = 'https://moved.example';
  await worker.api.loadSettings();
  await worker.api.syncOverlayRegistration();

  assert.equal(worker.registrations.length, 1, 'the old registration must be replaced, not duplicated');
  assert.deepEqual([...worker.registrations[0].matches], ['https://moved.example/*']);
});

test('revoking the permission tears the registration back down', async () => {
  const granted = [PATTERN];
  const worker = loadWorker({ get: async () => ({ seerrUrl: SEERR }), grantedOrigins: granted });
  await worker.ready;
  assert.equal(worker.registrations.length, 1);

  granted.length = 0;
  await worker.api.syncOverlayRegistration();

  assert.equal(worker.registrations.length, 0);
});

test('an unusable server URL registers nothing even when broad permission exists', async () => {
  for (const seerrUrl of ['', 'not a url', 'ftp://seerr.example', 'javascript:alert(1)']) {
    const worker = loadWorker({ get: async () => ({ seerrUrl }), grantedOrigins: [PATTERN, '*://*/*'] });
    await worker.ready;
    assert.equal(worker.registrations.length, 0, `should not register for ${JSON.stringify(seerrUrl)}`);
  }
});

test('repeated syncs converge rather than toggling the registration', async () => {
  const worker = loadWorker({ get: async () => ({ seerrUrl: SEERR }), grantedOrigins: [PATTERN] });
  await worker.ready;
  for (let i = 0; i < 3; i++) await worker.api.syncOverlayRegistration();

  assert.equal(worker.registrations.length, 1);
  assert.deepEqual([...worker.registrations[0].matches], [PATTERN]);
});

test('a port in the server URL is stripped, because match patterns cannot carry one', async () => {
  // Overseerr's default is :5055, so this is the common self-hosted shape.
  for (const [seerrUrl, expected] of [
    ['http://localhost:5055', 'http://localhost/*'],
    ['https://seerr.example:8443/requests', 'https://seerr.example/*'],
    ['http://192.168.1.10:5055/', 'http://192.168.1.10/*']
  ]) {
    const worker = loadWorker({ get: async () => ({ seerrUrl }), grantedOrigins: [expected] });
    await worker.ready;
    assert.equal(worker.registrations.length, 1, `${seerrUrl} should register`);
    assert.deepEqual([...worker.registrations[0].matches], [expected]);
    assert.ok(!worker.registrations[0].matches[0].includes(':5055'), 'no port may survive into the pattern');
  }
});

test('the options page and the worker derive the same pattern', () => {
  // If these drift, the Settings banner and the actual registration disagree:
  // one thinks the origin is granted while the other registered a different one.
  const PATTERN = '${url.protocol}//${url.hostname}/*';
  for (const file of ['src/background/background.js', 'src/options/options.js']) {
    assert.ok(fs.readFileSync(file, 'utf8').includes(PATTERN), `${file} should build the port-less pattern`);
  }
});

test('a browser without the scripting or permissions APIs degrades quietly', async () => {
  // settingsReady gates every message, so a rejection here would take the
  // whole extension down rather than merely disabling the overlay.
  for (const missing of ['scripting', 'permissions']) {
    const worker = loadWorker({ get: async () => ({ seerrUrl: SEERR }), grantedOrigins: [PATTERN], omitApis: [missing] });
    await worker.ready;

    assert.equal(await worker.api.syncOverlayRegistration(), false, `should report failure without ${missing}`);
    assert.equal(worker.logs.error.length, 0, `absent ${missing} is not an error`);
    assert.equal(worker.api.baseUrl, SEERR, 'settings still load');

    // The critical part: messages must still be answered.
    const response = await new Promise(resolve => worker.listeners.message({ action: 'ping' }, {}, resolve));
    assert.equal(response.success, true, `messages must still work without ${missing}`);
  }
});

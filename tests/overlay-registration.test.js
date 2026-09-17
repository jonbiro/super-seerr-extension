// The Seerr origin is only known at runtime, so the overlay is registered
// dynamically against the saved server once the host permission is granted.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loadWorker } = require('./helpers/worker');

const SEERR = 'https://seerr.example';
const PATTERN = 'https://seerr.example/*';

// Two scripts are registered together: the overlay in the isolated world, and
// the API observer in the page's own world.
const byId = (worker, id) => worker.registrations.find(script => script.id === id);
const overlayOf = worker => byId(worker, 'seerr-overlay');
const observerOf = worker => byId(worker, 'seerr-api-observer');

test('the overlay is registered for the saved origin once permission is granted', async () => {
  const worker = loadWorker({ get: async () => ({ seerrUrl: SEERR }), grantedOrigins: [PATTERN] });
  await worker.ready;

  assert.equal(worker.registrations.length, 2);

  const overlay = overlayOf(worker);
  assert.deepEqual([...overlay.matches], [PATTERN]);
  assert.equal(overlay.runAt, 'document_idle');
  assert.ok(overlay.js.includes('src/content/seerr-integration.js'));
  assert.ok(overlay.css.includes('src/content/seerr-overlay.css'));
  assert.ok(!overlay.world, 'the overlay stays in the isolated world');

  // Seerr unmounts a card's link until it is hovered, so the observer must see
  // the page's own fetch, and must be in place before the first request.
  const observer = observerOf(worker);
  assert.deepEqual([...observer.matches], [PATTERN]);
  assert.equal(observer.world, 'MAIN');
  assert.equal(observer.runAt, 'document_start');
  assert.ok(observer.js.includes('src/content/seerr-api-observer.js'));
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
  assert.deepEqual([...overlayOf(worker).matches], [PATTERN]);

  url = 'https://moved.example';
  await worker.api.loadSettings();
  await worker.api.syncOverlayRegistration();

  assert.equal(worker.registrations.length, 2, 'the old registrations must be replaced, not duplicated');
  for (const script of worker.registrations) {
    assert.deepEqual([...script.matches], ['https://moved.example/*'], `${script.id} should follow the server`);
  }
});

test('revoking the permission tears the registration back down', async () => {
  const granted = [PATTERN];
  const worker = loadWorker({ get: async () => ({ seerrUrl: SEERR }), grantedOrigins: granted });
  await worker.ready;
  assert.equal(worker.registrations.length, 2);

  granted.length = 0;
  await worker.api.syncOverlayRegistration();

  assert.equal(worker.registrations.length, 0, 'both scripts must be unregistered');
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

  assert.equal(worker.registrations.length, 2, 'repeated syncs must not duplicate either script');
  assert.deepEqual([...overlayOf(worker).matches], [PATTERN]);
  assert.deepEqual([...observerOf(worker).matches], [PATTERN]);
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
    assert.equal(worker.registrations.length, 2, `${seerrUrl} should register`);
    assert.deepEqual([...overlayOf(worker).matches], [expected]);
    assert.deepEqual([...observerOf(worker).matches], [expected]);
    assert.ok(!overlayOf(worker).matches[0].includes(':5055'), 'no port may survive into the pattern');
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

// Firefox WebExtensions need Marionette's temporary-addon support, which
// Playwright's Firefox launcher does not expose. Use the WebDriver protocol
// directly, without adding a second browser automation library.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { createExtension, startServer } = require('./fixture.cjs');
const Config = require('../../src/shared/RatingsConfig');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function eventually(read, expected, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  let actual;
  do {
    actual = await read();
    if (JSON.stringify(actual) === JSON.stringify(expected)) return actual;
    await delay(100);
  } while (Date.now() < deadline);
  assert.deepEqual(actual, expected, label);
}

async function unusedPort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('Firefox: permissions, real injection, SPA navigation, background reload and cache clearing', { timeout: 120000 }, async t => {
  const build = await createExtension('firefox');
  const { server, origin } = await startServer();
  const port = await unusedPort();
  const profileRoot = await fs.realpath(build.temporary);
  const driver = spawn(process.env.GECKODRIVER_PATH || 'geckodriver', ['--port', String(port), '--allow-system-access', '--profile-root', profileRoot, '--log', 'debug', '--log-no-truncate'], {
    stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32'
  });
  let driverLog = '', driverError, session;
  driver.stdout.on('data', data => { driverLog += data; });
  driver.stderr.on('data', data => { driverLog += data; });
  driver.on('error', error => { driverError = error; });

  async function command(route, body, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      method, headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000)
    });
    const { value } = await response.json();
    if (!response.ok || value?.error) throw new Error(`WebDriver ${route}: ${value?.message || response.status}`);
    return value;
  }
  const action = (route, body, method) => command(`/session/${session}${route}`, body, method);
  const navigate = url => action('/url', { url });
  const script = (source, args = []) => action('/execute/sync', { script: source, args });
  async function asyncScript(source, args = []) {
    const response = await action('/execute/async', { script: `
      const done = arguments[arguments.length - 1];
      (async () => { ${source} })().then(result => done({ result }), error => done({ error: String(error) }));
    `, args });
    if (response.error) throw new Error(response.error);
    return response.result;
  }
  const context = name => action('/moz/context', { context: name });
  const extensionScript = (source, args) => asyncScript(`const api = window.wrappedJSObject.browser; ${source}`, args);
  const message = request => extensionScript('return await api.runtime.sendMessage(arguments[0]);', [request]);

  t.after(async () => {
    if (session) await command(`/session/${session}`, undefined, 'DELETE').catch(() => {});
    // Also clean up the browser if startup failed before a session was made.
    try {
      if (process.platform !== 'win32') process.kill(-driver.pid, 'SIGKILL');
      else driver.kill();
    } catch (_) { /* already exited */ }
    await new Promise(resolve => server.close(resolve));
    await fs.rm(build.temporary, { recursive: true, force: true });
  });

  try {
    // Wait for the local driver only; no browser profile is reused.
    let listening = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (driverError) throw new Error(`Install geckodriver or set GECKODRIVER_PATH: ${driverError.message}`);
      try { await command('/status'); listening = true; break; } catch (_) { await delay(100); }
    }
    assert.ok(listening, 'geckodriver should start');
    const started = await command('/session', { capabilities: { alwaysMatch: {
      browserName: 'firefox',
      'moz:firefoxOptions': {
        ...(process.env.FIREFOX_BINARY ? { binary: process.env.FIREFOX_BINARY } : {}),
        args: ['-headless'],
        prefs: { 'extensions.autoDisableScopes': 0, 'browser.shell.checkDefaultBrowser': false }
      }
    } } });
    session = started.sessionId;
    await action('/timeouts', { script: 15000, pageLoad: 15000 });
    const addonId = await action('/moz/addon/install', { path: build.extension, temporary: true });
    assert.equal(addonId, build.manifest.browser_specific_settings.gecko.id);
    await context('chrome');
    const uuid = await script('return JSON.parse(Services.prefs.getStringPref("extensions.webextensions.uuids"))[arguments[0]];', [addonId]);
    assert.ok(uuid, 'temporary extension should have a runtime origin');
    await context('content');
    const optionsUrl = `moz-extension://${uuid}/src/options/options.html`;
    await navigate(optionsUrl);
    assert.equal((await message({ action: 'ping' })).success, true);
    assert.equal(await extensionScript('return await api.permissions.contains({ origins: ["http://127.0.0.1/*"] });'), false);
    await extensionScript('await api.storage.sync.set({ seerrUrl: arguments[0] }); await api.storage.local.set({ seerrApiKey: "smoke-key" });', [origin]);
    await message({ action: 'reloadSettings' });
    assert.deepEqual(await extensionScript('return await api.scripting.getRegisteredContentScripts();'), []);

    // Grant through Firefox's own permissions manager, not a mocked extension
    // API or an unautomatable native prompt. Emit the real permission event.
    await context('chrome');
    await asyncScript(`
      const { ExtensionPermissions } = ChromeUtils.importESModule('resource://gre/modules/ExtensionPermissions.sys.mjs');
      const policy = WebExtensionPolicy.getByID(arguments[0]);
      await ExtensionPermissions.add(arguments[0], { permissions: [], origins: ['http://127.0.0.1/*'] }, policy.extension);
    `, [addonId]);
    await context('content');
    await eventually(() => extensionScript('return (await api.scripting.getRegisteredContentScripts()).length;'), 2, 'optional permission registers both scripts');
    await navigate(`${origin}/discover`);
    const badges = () => script('return document.querySelectorAll(".seerr-card-badge").length;');
    await eventually(badges, 2, 'Firefox renders real content-script ratings');
    assert.equal(await script('return typeof window.wrappedJSObject.superSeerrDiagnose;'), 'function', 'MAIN-world observer is installed');
    await script('history.pushState({}, "", "/settings");');
    await eventually(badges, 0, 'unsupported SPA route removes badges');
    await script('history.back();');
    await eventually(badges, 2, 'back navigation restores one badge set');

    await navigate(optionsUrl);
    await extensionScript(`await api.storage.local.set({ rtCacheV1: { matcher: arguments[0], entries: {
      'movie:Example:2020': { value: { rtCriticsScore: 22 }, expiresAt: Date.now() + 60000 }
    } } });`, [Config.matcherVersion]);
    assert.equal((await message({ action: 'getRottenTomatoesRatings', data: { title: 'Example', year: 2020 } })).data.rtCriticsScore, 22);
    await extensionScript(`const { rtCacheV1 } = await api.storage.local.get('rtCacheV1');
      rtCacheV1.entries['movie:Example:2020'].value.rtCriticsScore = 88;
      await api.storage.local.set({ rtCacheV1 });`);
    await context('chrome');
    await asyncScript(`const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
      await (await AddonManager.getAddonByID(arguments[0])).reload();`, [addonId]);
    await context('content');
    await navigate(optionsUrl);
    assert.equal((await message({ action: 'getRottenTomatoesRatings', data: { title: 'Example', year: 2020 } })).data.rtCriticsScore, 88, 'reloaded background reads persisted rather than old in-memory data');
    const state = await message({ action: 'getConfigState' });
    assert.equal(state.data.apiConfigured, true);
    assert.equal(state.data.serverUrl, origin);
    assert.equal((await message({ action: 'clearRatingsCache' })).success, true);
    assert.equal(await extensionScript('return (await api.storage.local.get("rtCacheV1")).rtCacheV1 ?? null;'), null);
    assert.equal(await extensionScript('return await api.permissions.remove({ origins: ["http://127.0.0.1/*"] });'), true);
    await eventually(() => extensionScript('return (await api.scripting.getRegisteredContentScripts()).length;'), 0, 'revocation removes registered scripts');
    await navigate(`${origin}/discover`);
    assert.equal(await badges(), 0);
    t.diagnostic(`Validated Firefox ${started.capabilities.browserVersion}`);
  } catch (error) {
    const artifacts = path.resolve('test-results/firefox');
    await fs.mkdir(artifacts, { recursive: true });
    await fs.writeFile(path.join(artifacts, 'geckodriver.log'), driverLog);
    if (session) {
      const screenshot = await action('/screenshot').catch(() => null);
      if (screenshot) await fs.writeFile(path.join(artifacts, 'failure.png'), Buffer.from(screenshot, 'base64'));
    }
    throw error;
  }
});

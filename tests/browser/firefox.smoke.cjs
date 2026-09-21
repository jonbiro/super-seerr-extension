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
  const baseline = await createExtension('firefox', { ref: '4864269' });
  const { server, origin } = await startServer();
  const port = await unusedPort();
  const profileRoot = await fs.realpath(build.temporary);
  const driver = spawn(process.env.GECKODRIVER_PATH || 'geckodriver', ['--port', String(port), '--allow-system-access', '--profile-root', profileRoot, '--log', 'debug', '--log-no-truncate'], {
    stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32'
  });
  let driverLog = '', driverError, session, siteFixtures;
  driver.stdout.on('data', data => { driverLog += data; });
  driver.stderr.on('data', data => { driverLog += data; });
  driver.on('error', error => { driverError = error; });

  async function command(route, body, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      method, headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000)
    });
    const { value } = await response.json();
    if (!response.ok) throw new Error(`WebDriver ${route}: ${value?.message || value?.error || response.status}`);
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
  const extensionScript = (source, args) => asyncScript(`const api = (window.wrappedJSObject || window).browser; ${source}`, args);
  const message = request => extensionScript('return await api.runtime.sendMessage(arguments[0]);', [request]);

  t.after(async () => {
    siteFixtures?.close();
    if (session) await command(`/session/${session}`, undefined, 'DELETE').catch(() => {});
    // Also clean up the browser if startup failed before a session was made.
    try {
      if (process.platform !== 'win32') process.kill(-driver.pid, 'SIGKILL');
      else driver.kill();
    } catch (_) { /* already exited */ }
    await new Promise(resolve => server.close(resolve));
    await fs.rm(build.temporary, { recursive: true, force: true });
    await fs.rm(baseline.temporary, { recursive: true, force: true });
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
      browserName: 'firefox', webSocketUrl: true,
      'moz:firefoxOptions': {
        ...(process.env.FIREFOX_BINARY ? { binary: process.env.FIREFOX_BINARY } : {}),
        args: ['-headless'],
        prefs: { 'extensions.autoDisableScopes': 0, 'browser.shell.checkDefaultBrowser': false }
      }
    } } });
    session = started.sessionId;
    siteFixtures = await require('./bidi-fixtures.cjs').interceptSiteFixtures(started.capabilities.webSocketUrl);
    await action('/timeouts', { script: 15000, pageLoad: 15000 });
    const addonId = await action('/moz/addon/install', { path: baseline.extension, temporary: true });
    assert.equal(addonId, build.manifest.browser_specific_settings.gecko.id);
    await context('chrome');
    const uuid = await script('return JSON.parse(Services.prefs.getStringPref("extensions.webextensions.uuids"))[arguments[0]];', [addonId]);
    assert.ok(uuid, 'temporary extension should have a runtime origin');
    await context('content');
    const optionsUrl = `moz-extension://${uuid}/src/options/options.html`;
    await navigate(optionsUrl);
    assert.equal((await message({ action: 'ping' })).success, true);
    assert.equal(await extensionScript('return api.runtime.getManifest().version;'), '3.5.2');
    await extensionScript(`await api.storage.sync.set({ seerrUrl: arguments[0], jellyseerrUrl: arguments[0], jellyseerrApiKey: 'legacy-upgrade-key',
      overlayFeatures: { cardBadges: false }, seerrFilterPresetsV1: [{ name: 'Keep me', sort: 'rt-critics-desc', filters: { minCritics: 70 } }] });
      await api.storage.local.remove('seerrApiKey');
      await api.storage.local.set({ plexToken: 'saved-plex-token' });`, [origin]);
    await navigate(`${origin}/settings`);
    assert.equal(await action('/moz/addon/install', { path: build.extension, temporary: true }), addonId);
    await navigate(optionsUrl);
    assert.equal((await message({ action: 'ping' })).success, true);
    const upgraded = await extensionScript(`return { version: api.runtime.getManifest().version,
      sync: await api.storage.sync.get(), local: await api.storage.local.get(['seerrApiKey', 'plexToken']) };`);
    assert.equal(upgraded.version, build.manifest.version);
    assert.equal(upgraded.sync.seerrUrl, origin);
    assert.equal(upgraded.sync.overlayFeatures.cardBadges, false);
    assert.equal(upgraded.sync.seerrFilterPresetsV1[0].name, 'Keep me');
    for (const key of ['jellyseerrUrl', 'jellyseerrApiKey', 'seerrApiKey']) assert.equal(upgraded.sync[key], undefined);
    assert.deepEqual(upgraded.local, { seerrApiKey: 'legacy-upgrade-key', plexToken: 'saved-plex-token' });
    await extensionScript(`await api.storage.local.remove('plexToken'); await api.storage.sync.set({ overlayFeatures: { cardBadges: true } });`);
    t.diagnostic('Actual 3.5.2 upgrade preserved settings and migrated legacy secrets');
    const localAccessControls = await extensionScript('return typeof api.storage.local.setAccessLevel === "function";');
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
    assert.equal(await script('return typeof (window.wrappedJSObject || window).superSeerrDiagnose;'), 'function', 'MAIN-world observer is installed');
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
    // Reload closes extension documents; keep the WebDriver caller on a normal page.
    await navigate(`${origin}/settings`);
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
    assert.equal((await message({ action: 'addToWatchlist', data: { title: 'Fight Club', tmdbId: 550, mediaType: 'movie', year: 1999 } })).success, true);
    const optionsHandle = await action('/window');
    const previousHandles = await action('/window/handles');
    await extensionScript(`
      const tab = await api.tabs.create({ url: arguments[0] });
      for (let attempt = 0; attempt < 100; attempt++) {
        const current = await api.tabs.get(tab.id);
        if (current.status === 'complete' && current.url === arguments[0]) break;
        if (attempt === 99) throw new Error('Picker fixture did not finish loading');
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      // Firefox executes this classic script but cannot serialize its final
      // class assignment. The next call uses the actual exported class.
      await api.scripting.executeScript({ target: { tabId: tab.id }, files: ['/src/shared/SeasonPicker.js', '/src/shared/UIComponents.js'] }).catch(error => {
        if (!String(error).includes('non-structured-clonable')) throw error;
      });
      await api.scripting.executeScript({ target: { tabId: tab.id }, func: async () => {
        const result = await chrome.runtime.sendMessage({ action: 'getMediaCandidates', data: { title: 'The Thing', mediaType: 'movie' } });
        const cache = await chrome.runtime.sendMessage({ action: 'getOverlayCache' });
        document.body.dataset.cacheBridge = String(cache.success);
        try { await chrome.storage.local.get('seerrApiKey'); document.body.dataset.localReadBlocked = 'no'; }
        catch (_) { document.body.dataset.localReadBlocked = 'yes'; }
        const ui = new window.UIComponents();
        ui.chooseTitle(result.data, { title: 'The Thing' }).then(async choice => {
          document.body.dataset.chosenTitle = choice ? String(choice.tmdbId) : 'cancelled';
          if (!choice) return;
          const options = await chrome.runtime.sendMessage({ action: 'getSeasonOptions', data: { title: 'Example Series', mediaType: 'tv', tmdbId: 920 } });
          const selected = await window.chooseSeerrSeasons(options.data, { confirmText: 'Use selected seasons' });
          document.body.dataset.chosenSeasons = JSON.stringify(selected);
        });
      } });
    `, [`${origin}/title/picker`]);
    const pickerHandle = (await action('/window/handles')).find(handle => !previousHandles.includes(handle));
    await action('/window', { handle: pickerHandle });
    await eventually(() => script('return document.querySelectorAll(".seerr-title-choice").length;'), 2, 'Firefox renders ambiguous title candidates');
    assert.equal(await script('return document.body.dataset.cacheBridge;'), 'true');
    if (localAccessControls) assert.equal(await script('return document.body.dataset.localReadBlocked;'), 'yes');
    t.diagnostic(`Firefox local storage access controls available: ${localAccessControls}`);
    await script('document.querySelectorAll(".seerr-title-choice")[1].click();');
    await eventually(() => script('return document.body.dataset.chosenTitle;'), '911', 'Firefox picker returns the explicit choice');
    await eventually(() => script('return document.querySelectorAll(".seerr-season-picker input").length;'), 3, 'Firefox renders season availability');
    assert.equal(await script('return document.querySelectorAll(".seerr-season-picker input")[0].disabled;'), true);
    await script('document.querySelectorAll(".seerr-season-picker input")[1].click(); Array.from(document.querySelectorAll(".seerr-season-picker button")).find(button => button.textContent === "Use selected seasons").click();');
    await eventually(() => script('return document.body.dataset.chosenSeasons;'), '[2]', 'Firefox confirms only the selected season');
    await action('/window', undefined, 'DELETE');
    await action('/window', { handle: optionsHandle });
    await navigate(`moz-extension://${uuid}/src/popup/popup.html`);
    await eventually(() => script('return document.getElementById("diagnosticChecks").textContent.includes("API key: OK");'), true, 'Firefox popup verifies the configured key');
    await eventually(() => script('return document.getElementById("recentActionsList").textContent.includes("Fight Club");'), true, 'Firefox popup displays confirmed actions');
    await script('document.getElementById("clearRecentActions").click();');
    await eventually(() => script('return document.querySelectorAll("#recentActionsList li").length;'), 0, 'Firefox popup clears local history');
    await navigate(optionsUrl);
    assert.equal(await extensionScript('return await api.permissions.remove({ origins: ["http://127.0.0.1/*"] });'), true);
    await eventually(() => extensionScript('return (await api.scripting.getRegisteredContentScripts()).length;'), 0, 'revocation removes registered scripts');
    await navigate(`${origin}/discover`);
    assert.equal(await badges(), 0);
    // Exercise the shipped manifest and complete bootstrap on all seven sites.
    await context('chrome');
    await asyncScript(`
      const { ExtensionPermissions } = ChromeUtils.importESModule('resource://gre/modules/ExtensionPermissions.sys.mjs');
      const policy = WebExtensionPolicy.getByID(arguments[0]);
      await ExtensionPermissions.add(arguments[0], { permissions: [], origins: ['http://127.0.0.1/*'] }, policy.extension);
    `, [addonId]);
    await context('content');
    for (const fixture of require('./site-fixtures.cjs').SITES) {
      await navigate(fixture.url);
      await eventually(() => script('return document.querySelectorAll(".seerr-flyout").length;'), 1, `${fixture.site} ${fixture.expect.mediaType}: one packaged flyout`);
      assert.equal(await script('return document.querySelector(".seerr-title").textContent;'), fixture.expect.title);
      assert.ok((await script('return document.querySelector(".seerr-year").textContent;')).includes(fixture.expect.mediaType === 'tv' ? 'TV Series' : 'Movie'));
      await script('document.querySelector(".seerr-tab").click();');
      assert.equal(await script('return document.querySelector(".seerr-tab").getAttribute("aria-expanded");'), 'true');
      t.diagnostic(`Firefox packaged fixture passed: ${fixture.site} ${fixture.expect.mediaType}`);
    }
    assert.deepEqual(siteFixtures.errors, []);
    t.diagnostic(`Validated Firefox ${started.capabilities.browserVersion}`);
  } catch (error) {
    const artifacts = path.resolve('test-results/firefox');
    await fs.mkdir(artifacts, { recursive: true });
    await fs.writeFile(path.join(artifacts, 'geckodriver.log'), driverLog);
    if (session) {
      await context('chrome').catch(() => {});
      const browserErrors = await script('return Services.console.getMessageArray().map(item => item.message).slice(-80);').catch(() => []);
      await fs.writeFile(path.join(artifacts, 'browser-errors.json'), JSON.stringify(browserErrors, null, 2));
      await context('content').catch(() => {});
      const screenshot = await action('/screenshot').catch(() => null);
      const isolatedState = await (async () => {
        const previousUrl = await script('return location.href;');
        const diagnosticTab = await action('/window/new', { type: 'tab' });
        await action('/window', { handle: diagnosticTab.handle });
        await navigate(`moz-extension://${await (async () => {
          await context('chrome');
          const id = await script('return JSON.parse(Services.prefs.getStringPref("extensions.webextensions.uuids"))[arguments[0]];', [build.manifest.browser_specific_settings.gecko.id]);
          await context('content');
          return id;
        })()}/src/options/options.html`);
        return await extensionScript(`
          const tabs = await api.tabs.query({});
          const tab = tabs.find(tab => tab.url === arguments[0]);
          return await api.scripting.executeScript({ target: { tabId: tab.id }, func: () => ({
            windowConfig: !!window.RatingsConfig, globalConfig: !!globalThis.RatingsConfig,
            windowModel: !!window.RatingsModel, globalModel: !!globalThis.RatingsModel,
            windowCache: !!window.createOverlayCache, globalCache: !!globalThis.createOverlayCache,
            installed: !!window.__seerr_overlay_installed
          }) });
        `, [previousUrl]);
      })().catch(error => String(error));
      await fs.writeFile(path.join(artifacts, 'isolated-state.json'), JSON.stringify(isolatedState, null, 2));
      if (screenshot) await fs.writeFile(path.join(artifacts, 'failure.png'), Buffer.from(screenshot, 'base64'));
    }
    throw error;
  }
});

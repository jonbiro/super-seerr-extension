const { test, expect, chromium } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createExtension, startServer } = require('./fixture.cjs');

let context, options, extensionId, temporary, server, origin;
let pageErrors = [];

test.beforeAll(async () => {
  ({ server, origin } = await startServer());
  const build = await createExtension('chrome');
  temporary = build.temporary;
  const extension = build.extension;
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  context.on('page', page => page.on('pageerror', error => pageErrors.push(error.message)));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).host;
  options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/src/options/options.html`);
});

test.beforeEach(async () => {
  pageErrors = [];
});

test.afterEach(async () => {
  expect(pageErrors, 'uncaught errors in real extension pages').toEqual([]);
});

test.afterAll(async () => {
  await context?.close();
  await new Promise(resolve => server ? server.close(resolve) : resolve());
  if (temporary) await fs.rm(temporary, { recursive: true, force: true });
});

test('optional host permission controls registration, real SPA navigation and revocation', async () => {
  expect(await options.evaluate(() => chrome.permissions.contains({ origins: ['http://127.0.0.1/*'] }))).toBe(false);
  await options.evaluate(async serverUrl => {
    await chrome.storage.sync.set({ seerrUrl: serverUrl });
    await chrome.runtime.sendMessage({ action: 'reloadSettings' });
  }, origin);
  expect(await options.evaluate(() => chrome.scripting.getRegisteredContentScripts())).toEqual([]);
  // Grant through Chromium's extension manager (the API backing its site-access
  // UI). Native permission bubbles are outside Playwright's DOM automation.
  // No production APIs or permission results are mocked.
  const manager = await context.newPage();
  await manager.goto('chrome://extensions');
  await manager.evaluate(id => chrome.developerPrivate.addHostPermission(id, 'http://127.0.0.1/*'), extensionId);
  await manager.close();
  await options.locator('#serverUrl').fill(origin);
  await options.locator('#apiKey').fill('smoke-key');
  await options.locator('button[type="submit"]').click();
  await expect.poll(() => options.evaluate(() => chrome.permissions.contains({ origins: ['http://127.0.0.1/*'] }))).toBe(true);
  await expect.poll(() => options.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).length)).toBe(2);
  const page = await context.newPage();
  await page.bringToFront();
  await page.goto(`${origin}/discover`);
  await expect(page.locator('.seerr-card-badge')).toHaveCount(2);
  await page.evaluate(() => history.pushState({}, '', '/search?query=Fight'));
  await expect(page.locator('.seerr-card-badge')).toHaveCount(2);
  await page.evaluate(() => history.pushState({}, '', '/settings'));
  await expect(page.locator('.seerr-card-badge')).toHaveCount(0);
  await page.evaluate(() => history.back());
  await expect(page.locator('.seerr-card-badge')).toHaveCount(2);
  expect(await options.evaluate(() => chrome.permissions.remove({ origins: ['http://127.0.0.1/*'] }))).toBe(true);
  await expect.poll(() => options.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).length)).toBe(0);
  await page.reload();
  await expect(page.locator('[data-seerr-overlay="true"]')).toHaveCount(0);
  await page.close();
});

test('worker restart preserves configuration and cache; clear removes persisted ratings', async () => {
  // Storage is real extension storage, and termination is through CDP rather
  // than a simulated new JS object.
  await options.evaluate(async ({ origin, matcher }) => {
    await chrome.storage.sync.set({ seerrUrl: origin });
    await chrome.storage.local.set({ seerrApiKey: 'smoke-key', rtCacheV1: { matcher, entries: {
      'movie:Example:2020': { value: { rtCriticsScore: 22 }, expiresAt: Date.now() + 60000 }
    } } });
    await chrome.runtime.sendMessage({ action: 'reloadSettings' });
  }, { origin, matcher: require('../../src/shared/RatingsConfig').matcherVersion });
  const before = await options.evaluate(() => chrome.runtime.sendMessage({ action: 'getRottenTomatoesRatings', data: { title: 'Example', year: 2020 } }));
  expect(before.data.rtCriticsScore).toBe(22);
  await options.evaluate(async () => {
    const { rtCacheV1 } = await chrome.storage.local.get('rtCacheV1');
    rtCacheV1.entries['movie:Example:2020'].value.rtCriticsScore = 88;
    await chrome.storage.local.set({ rtCacheV1 });
  });
  const cdp = await context.newCDPSession(options);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  const result = await options.evaluate(() => chrome.runtime.sendMessage({ action: 'getRottenTomatoesRatings', data: { title: 'Example', year: 2020 } }));
  expect(result.success).toBe(true);
  expect(result.data.rtCriticsScore).toBe(88);
  const state = await options.evaluate(() => chrome.runtime.sendMessage({ action: 'getConfigState' }));
  expect(state.data.serverUrl).toBe(origin);
  expect(state.data.apiConfigured).toBe(true);
  expect(await options.evaluate(() => chrome.runtime.sendMessage({ action: 'clearRatingsCache' }))).toEqual({ success: true });
  expect(await options.evaluate(async () => (await chrome.storage.local.get('rtCacheV1')).rtCacheV1)).toBeUndefined();
  await cdp.detach();
});

test('an expanded site flyout follows SPA navigation and is removed on destroy', async () => {
  const manager = await context.newPage();
  await manager.goto('chrome://extensions');
  await manager.evaluate(id => chrome.developerPrivate.addHostPermission(id, 'http://127.0.0.1/*'), extensionId);
  await manager.close();
  await options.locator('#serverUrl').fill(origin);
  await options.locator('button[type="submit"]').click();
  await expect.poll(() => options.evaluate(() => chrome.permissions.contains({ origins: ['http://127.0.0.1/*'] }))).toBe(true);
  const page = await context.newPage();
  await page.goto(`${origin}/title/first`);
  await page.locator('h1').evaluate(element => { element.textContent = 'First title'; });
  await page.bringToFront();
  const tabId = await options.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id);
  await options.evaluate(async tabId => {
    await chrome.scripting.executeScript({ target: { tabId }, files: [
      'src/shared/SeerrClient.js', 'src/shared/MediaExtractor.js',
      'src/shared/UIComponents.js', 'src/shared/BaseIntegration.js'
    ] });
    await chrome.scripting.executeScript({ target: { tabId }, func: async () => {
      class NavigationProbe extends window.BaseIntegration {
        constructor() { super('NavigationProbe', { uiTheme: 'flyout', retryDelay: 100000 }); }
        async extractMediaData() {
          return { title: document.querySelector('h1').textContent, tmdbId: 550, mediaType: 'movie' };
        }
      }
      window.navigationProbe = new NavigationProbe();
      await window.navigationProbe.init();
    } });
  }, tabId);
  await expect(page.locator('.seerr-title')).toHaveText('First title');
  await page.locator('.seerr-tab').click();
  await expect(page.locator('.seerr-flyout')).toHaveClass(/expanded/);
  await page.evaluate(() => {
    document.querySelector('h1').textContent = 'Second title';
    history.pushState({}, '', '/title/second');
  });
  await expect(page.locator('.seerr-title')).toHaveText('Second title');
  await expect(page.locator('.seerr-flyout')).toHaveCount(1);
  await page.locator('.seerr-tab').click();
  await options.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId }, func: () => window.navigationProbe.destroy() }), tabId);
  await expect(page.locator('.seerr-flyout')).toHaveCount(0);
  await page.close();
});

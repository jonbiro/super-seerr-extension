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
      'src/shared/NotificationCenter.js', 'src/shared/UIComponents.js', 'src/shared/BaseIntegration.js'
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
  const tabButton = page.getByRole('button', { name: 'Open Super Seerr', exact: true });
  await tabButton.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.seerr-panel')).toBeFocused();
  await expect(page.locator('.seerr-tab')).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(tabButton).toBeFocused();
  await expect(page.locator('.seerr-panel')).toHaveAttribute('inert', '');
  await page.keyboard.press('Space');
  await expect(page.locator('.seerr-flyout')).toHaveClass(/expanded/);
  await page.evaluate(() => {
    document.querySelector('h1').textContent = 'Second title';
    history.pushState({}, '', '/title/second');
  });
  await expect(page.locator('.seerr-title')).toHaveText('Second title');
  await expect(page.locator('.seerr-flyout')).toHaveCount(1);
  await page.locator('.seerr-tab').click();
  let watchlistPosts = 0;
  const countPost = request => {
    if (request.method === 'POST' && request.url === '/api/v1/watchlist') watchlistPosts++;
  };
  server.on('request', countPost);
  try {
    await expect(page.locator('.seerr-watchlist-button')).toBeVisible();
    await page.locator('.seerr-watchlist-button').evaluate(button => { button.click(); button.click(); });
    await expect(page.locator('.seerr-notification')).toContainText('Added to Watchlist');
    expect(watchlistPosts).toBe(1);
  } finally {
    server.off('request', countPost);
  }
  await options.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId }, func: () => window.navigationProbe.destroy() }), tabId);
  await expect(page.locator('.seerr-flyout')).toHaveCount(0);
  await page.close();
});

test('old ratings render immediately and update after the background refresh', async () => {
  const Config = require('../../src/shared/RatingsConfig');
  await options.evaluate(async ({ origin, matcher }) => {
    const { ratingsCacheEpoch } = await chrome.storage.local.get('ratingsCacheEpoch');
    await chrome.storage.local.set({ overlayRatingsV1: {
      server: `${origin}/`, epoch: ratingsCacheEpoch ?? 0, matcher, entries: { 'movie:550': {
        bundle: { rtCriticsScore: 10, rtAudienceScore: 20, imdbRating: 3, tmdbRating: 4, confidence: 1, source: 'cached' },
        cachedAt: Date.now() - 2 * 86400000
      } }
    } });
  }, { origin, matcher: Config.matcherVersion });
  const page = await context.newPage();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/v1/movie/550/ratingscombined', async route => { await gate; await route.continue(); });
  try {
    await page.goto(`${origin}/discover`);
    await expect(page.locator('.seerr-card-badge').first()).toContainText('10%');
    release();
    await expect(page.locator('.seerr-card-badge').first()).toContainText('85%');
    await page.locator('.seerr-rating-details summary').click();
    await expect(page.locator('.seerr-rating-details')).toContainText('Last checked:');
    await expect(page.locator('.seerr-rating-details button')).toHaveText('Retry scores');
    await page.screenshot({ path: 'test-results/ratings-details.png' });
  } finally { release(); await page.close(); }
});

test('popup diagnoses connections and shows confirmed local actions with working repairs and clearing', async () => {
  const result = await options.evaluate(() => chrome.runtime.sendMessage({
    action: 'addToWatchlist', data: { title: 'Fight Club', tmdbId: 550, mediaType: 'movie', year: 1999 }
  }));
  expect(result.success).toBe(true);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
  await expect(popup.locator('#diagnosticChecks')).toContainText('Seerr connection: OK');
  await expect(popup.locator('#diagnosticChecks')).toContainText('API key: OK');
  await expect(popup.locator('#recentActionsList')).toContainText('Added to Seerr watchlist: Fight Club');
  const settingsPromise = context.waitForEvent('page');
  await popup.getByRole('button', { name: 'Fix plex', exact: true }).click();
  const settingsPage = await settingsPromise;
  await settingsPage.waitForLoadState('domcontentloaded');
  await expect(settingsPage.locator('#plexToken')).toBeFocused();
  await settingsPage.close();
  await popup.getByRole('button', { name: 'Clear history', exact: true }).click();
  await expect(popup.locator('#recentActionsList li')).toHaveCount(0);
  await expect(popup.locator('#recentActionsStatus')).toHaveText('No confirmed actions yet.');
  await options.evaluate(() => chrome.permissions.remove({ origins: ['http://127.0.0.1/*'] }));
  await popup.locator('#testConnection').click();
  await expect(popup.locator('#diagnosticChecks')).toContainText('Seerr host access is missing.');
  const permissionPagePromise = context.waitForEvent('page');
  await popup.getByRole('button', { name: 'Fix host permission', exact: true }).click();
  const permissionPage = await permissionPagePromise;
  await expect(permissionPage.locator('#grantPermission')).toBeFocused();
  await permissionPage.close();
  await popup.close();
});

test('ambiguous title picker checks the chosen identity and sends only a separately confirmed request', async () => {
  const manager = await context.newPage();
  await manager.goto('chrome://extensions');
  await manager.evaluate(id => chrome.developerPrivate.addHostPermission(id, 'http://127.0.0.1/*'), extensionId);
  await manager.close();
  await options.locator('#serverUrl').fill(origin);
  await options.locator('button[type="submit"]').click();
  await expect.poll(() => options.evaluate(() => chrome.permissions.contains({ origins: ['http://127.0.0.1/*'] }))).toBe(true);
  const page = await context.newPage();
  await page.goto(`${origin}/title/ambiguous`); await page.bringToFront();
  const tabId = await options.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id);
  await options.evaluate(async tabId => {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['src/shared/SeerrClient.js', 'src/shared/MediaExtractor.js', 'src/shared/NotificationCenter.js', 'src/shared/UIComponents.js', 'src/shared/BaseIntegration.js'] });
    await chrome.scripting.executeScript({ target: { tabId }, func: async () => {
      class PickerProbe extends window.BaseIntegration {
        constructor() { super('PickerProbe', { uiTheme: 'flyout', retryDelay: 100000 }); }
        async extractMediaData() { return { title: 'The Thing', mediaType: 'movie' }; }
      }
      window.pickerProbe = new PickerProbe(); await window.pickerProbe.init();
    } });
  }, tabId);
  const posts = [];
  const capture = request => {
    if (request.method !== 'POST' || request.url !== '/api/v1/request') return;
    let body = ''; request.on('data', chunk => { body += chunk; }); request.on('end', () => posts.push(JSON.parse(body)));
  };
  server.on('request', capture);
  try {
    await page.getByRole('button', { name: 'Open Super Seerr', exact: true }).click();
    await page.getByRole('button', { name: 'Choose title', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Choose matching title' })).toBeVisible();
    await page.getByLabel('Remember this match on this device').check();
    await page.getByRole('button', { name: /The Thing \(2011\)/ }).click();
    await expect(page.locator('.seerr-title')).toHaveText('The Thing (2011)');
    await expect(page.getByRole('button', { name: 'Request on Seerr', exact: true })).toBeVisible();
    expect(posts).toHaveLength(0);
    await page.getByRole('button', { name: 'Request on Seerr', exact: true }).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0].mediaId).toBe(911);
    expect(posts[0].mediaType).toBe('movie');
    const saved = await options.evaluate(() => chrome.runtime.sendMessage({ action: 'getSavedTitleCorrection', data: { title: 'The Thing', mediaType: 'movie' } }));
    expect(saved.data.tmdbId).toBe(911);

  } finally {
    server.off('request', capture);
    await page.close();
  }
});

test('TV request review shows availability and posts only explicitly selected seasons', async () => {
  const page = await context.newPage();
  await page.goto(`${origin}/title/seasons`); await page.bringToFront();
  const tabId = await options.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id);
  await options.evaluate(async tabId => {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['src/shared/SeerrClient.js', 'src/shared/MediaExtractor.js', 'src/shared/SeasonPicker.js', 'src/shared/NotificationCenter.js', 'src/shared/UIComponents.js', 'src/shared/BaseIntegration.js'] });
    await chrome.scripting.executeScript({ target: { tabId }, func: async () => {
      class SeasonProbe extends window.BaseIntegration {
        constructor() { super('SeasonProbe', { uiTheme: 'flyout', retryDelay: 100000 }); }
        async extractMediaData() { return { title: 'Example Series', mediaType: 'tv', tmdbId: 920 }; }
      }
      window.seasonProbe = new SeasonProbe(); await window.seasonProbe.init();
    } });
  }, tabId);
  const posts = [];
  const capture = request => {
    if (request.method !== 'POST' || request.url !== '/api/v1/request') return;
    let body = ''; request.on('data', chunk => { body += chunk; }); request.on('end', () => posts.push(JSON.parse(body)));
  };
  server.on('request', capture);
  try {
    await page.getByRole('button', { name: 'Open Super Seerr', exact: true }).click();
    await page.getByRole('button', { name: 'Choose TV seasons', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Choose TV seasons' });
    await expect(dialog.getByLabel('Season 1 (8 episodes) — Available', { exact: true })).toBeDisabled();
    await expect(dialog.getByLabel('Season 3 (8 episodes) — Pending', { exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Request selected seasons' })).toBeDisabled();
    await dialog.getByLabel('Season 2 (8 episodes) — Not available', { exact: true }).check();
    expect(posts).toHaveLength(0);
    await dialog.getByRole('button', { name: 'Request selected seasons' }).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0].seasons).toEqual([2]); expect(posts[0].mediaId).toBe(920);
  } finally { server.off('request', capture); await page.close(); }
});

test('content scripts cannot access local secrets; cache bridge and clear notifications still work', async () => {
  const page = await context.newPage();
  await page.goto(`${origin}/discover`); await page.bringToFront();
  await expect(page.locator('.seerr-card-badge')).toHaveCount(2);
  const tabId = await options.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id);
  const result = await options.evaluate(async tabId => {
    const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: async () => {
      let denied = false;
      try { await chrome.storage.local.get('seerrApiKey'); } catch (_) { denied = true; }
      const response = await chrome.runtime.sendMessage({ action: 'getOverlayCache' });
      return { denied, success: response.success, keys: Object.keys(response.data || {}) };
    } }); return result.result;
  }, tabId);
  expect(result.denied).toBe(true); expect(result.success).toBe(true);
  expect(result.keys.sort()).toEqual(['overlayRatingsV1', 'ratingsCacheEpoch']);
  await options.evaluate(async tabId => {
    await chrome.scripting.executeScript({ target: { tabId }, func: () => {
      document.body.dataset.cacheCleared = 'no';
      chrome.runtime.onMessage.addListener(message => {
        if (message.action !== 'seerrStateChanged') return;
        if (message.cacheCleared) document.body.dataset.cacheCleared = 'yes';
        else { document.body.dataset.configChanged = 'yes'; document.body.dataset.stateKeys = Object.keys(message).sort().join(','); }
      });
    } });
  }, tabId);
  await options.evaluate(() => chrome.runtime.sendMessage({ action: 'clearRatingsCache' }));
  await expect(page.locator('body')).toHaveAttribute('data-cache-cleared', 'yes');
  await expect(page.locator('.seerr-card-badge')).toHaveCount(2);
  expect(await options.evaluate(async () => (await chrome.storage.local.get('seerrApiKey')).seerrApiKey)).toBe('smoke-key');
  await options.evaluate(() => chrome.storage.local.set({ seerrApiKey: 'smoke-key-2' }));
  await expect(page.locator('body')).toHaveAttribute('data-config-changed', 'yes');
  await expect(page.locator('body')).toHaveAttribute('data-state-keys', 'action,cacheCleared');
  await options.evaluate(() => chrome.storage.local.set({ seerrApiKey: 'smoke-key' }));
  await page.close();
});

for (const fixture of require('./site-fixtures.cjs').SITES) {
  test(`packaged ${fixture.site} integration boots on its ${fixture.expect.mediaType} fixture`, async () => {
    const page = await context.newPage();
    // Only the webpage is a fixture. Manifest matching, script order, bootstrap,
    // DOM extraction, worker messages, and the rendered flyout are production.
    await page.route('**/*', route => route.request().isNavigationRequest()
      ? route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><title>Decoy fallback title</title></head><body>${fixture.html}</body></html>` })
      : route.abort());
    await page.goto(fixture.url, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.seerr-flyout')).toHaveCount(1, { timeout: 15000 });
    await page.getByRole('button', { name: 'Open Super Seerr', exact: true }).click();
    await expect(page.locator('.seerr-title')).toHaveText(fixture.expect.title);
    await expect(page.locator('.seerr-year')).toContainText(fixture.expect.mediaType === 'tv' ? 'TV Series' : 'Movie');
    if (fixture.expect.year) await expect(page.locator('.seerr-year')).toContainText(String(fixture.expect.year));
    await expect(page.locator('.seerr-action-button')).not.toContainText('Connecting');
    if (fixture.expect.mediaType === 'tv') await expect(page.getByRole('button', { name: 'Choose TV seasons', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.seerr-tab')).toHaveAttribute('aria-expanded', 'false');
    await page.close();
  });
}


test('Settings inspects and forgets remembered matches and exports a redacted diagnostic report', async () => {
  await options.getByRole('button', { name: 'Inspect saved title matches' }).click();
  const row = options.locator('li').filter({ hasText: 'TMDB 911' });
  await expect(row).toContainText('The Thing');
  await options.getByRole('searchbox', { name: 'Search saved matches' }).fill('no matching title');
  await expect(row).toHaveCount(0);
  await options.getByRole('searchbox', { name: 'Search saved matches' }).fill('911');
  await row.locator('summary').click();
  await expect(row.locator('dl')).toBeVisible();
  await expect(row.locator('dl')).toContainText(new URL(origin).host);
  await row.getByRole('button', { name: 'Forget match' }).click();
  await expect(row).toHaveCount(0);
  await options.getByRole('button', { name: 'Prepare diagnostic report' }).click();
  const preview = options.getByLabel('Diagnostic report preview');
  await expect(preview).toBeVisible();
  const report = JSON.parse(await preview.inputValue());
  expect(Object.keys(report.checks).sort()).toEqual(['apiKey', 'permission', 'plex', 'seerr']);
  expect(await preview.inputValue()).not.toContain(origin);
  expect(await preview.inputValue()).not.toContain('smoke-key');
  const downloading = options.waitForEvent('download');
  await options.getByRole('button', { name: 'Download report' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('super-seerr-diagnostics.json');
  const stream = await download.createReadStream(); let contents = '';
  for await (const chunk of stream) contents += chunk;
  expect(JSON.parse(contents)).toEqual(report);
});

test('recent confirmed requests show current status and exact Seerr title links', async () => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
  const row = popup.locator('#recentActionsList li').filter({ hasText: 'Requested: The Thing' });
  await expect(row.getByRole('link', { name: 'Open in Seerr' })).toHaveAttribute('href', `${origin}/movie/911`);
  await expect(row).toContainText('Not requested'); // The fixture serves an empty request history.
  await popup.getByRole('button', { name: 'Refresh statuses' }).click();
  await expect(row.getByRole('link')).toHaveCount(1);
  await popup.close();
});

test('bulk review fits a short narrow viewport and Escape restores focus', async () => {
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 320, height: 320 });
    await page.goto(`${origin}/discover`);
    await page.getByRole('button', { name: 'Select titles', exact: true }).click();
    await page.locator('.seerr-select-checkbox').click();
    const review = page.locator('.seerr-bulk-review');
    const toolbarBounds = await page.locator('.seerr-bulk-action-bar').boundingBox();
    expect(toolbarBounds.x).toBeGreaterThanOrEqual(0);
    expect(toolbarBounds.x + toolbarBounds.width).toBeLessThanOrEqual(320);
    await review.click();
    const dialog = page.getByRole('dialog', { name: 'Review your bulk request' });
    await expect(dialog).toBeVisible();
    await dialog.locator('li').first().evaluate(node => { node.textContent = 'VeryLongTitle'.repeat(40); });
    const bounds = await dialog.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(320);
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).focus();
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
    await expect(review).toBeFocused();
  } finally { await page.close(); }
});

test('presets saved concurrently in two tabs synchronize without losing either change', async () => {
  const manager = await context.newPage();
  await manager.goto('chrome://extensions');
  await manager.evaluate(id => chrome.developerPrivate.addHostPermission(id, 'http://127.0.0.1/*'), extensionId);
  await manager.close();
  await options.evaluate(async serverUrl => {
    await chrome.storage.sync.set({ seerrUrl: serverUrl, seerrFilterPresetsV1: [] });
    await chrome.runtime.sendMessage({ action: 'reloadSettings' });
  }, origin);
  const tabs = await Promise.all([context.newPage(), context.newPage()]);
  try {
    await Promise.all(tabs.map(page => page.goto(`${origin}/discover`)));
    for (let i = 0; i < tabs.length; i++) {
      await expect(tabs[i].getByRole('button', { name: 'Save preset', exact: true })).toBeEnabled();
      await tabs[i].getByRole('textbox', { name: 'Preset name', exact: true }).fill(`Tab ${i + 1}`);
    }
    await Promise.all(tabs.map(page => page.getByRole('button', { name: 'Save preset', exact: true }).click()));
    for (const page of tabs) {
      await expect(page.getByLabel('Saved filter presets').locator('option')).toHaveCount(3);
      await expect(page.getByLabel('Saved filter presets')).toContainText('Tab 1');
      await expect(page.getByLabel('Saved filter presets')).toContainText('Tab 2');
    }
    await tabs[1].getByLabel('Saved filter presets').selectOption('Tab 1');
    await tabs[0].getByLabel('Saved filter presets').selectOption('Tab 1');
    await tabs[0].getByRole('button', { name: 'Delete preset', exact: true }).click();
    await expect(tabs[1].getByLabel('Saved filter presets').locator('option')).toHaveCount(2);
    await expect(tabs[1].getByLabel('Saved filter presets')).not.toContainText('Tab 1');
    await expect(tabs[1].getByLabel('Saved filter presets')).toHaveValue('');
    expect(await tabs[1].getByLabel('Saved filter presets').evaluate(select => select.selectedIndex)).toBe(0);
    await expect(tabs[1].getByRole('button', { name: 'Delete preset', exact: true })).toBeDisabled();
  } finally { await Promise.all(tabs.map(page => page.close())); }
});

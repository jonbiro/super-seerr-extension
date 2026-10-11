const { test, expect, chromium } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createExtension, startServer } = require('./fixture.cjs');

test('save, switch, edit, and remove a second Seerr site without mixing API keys', async () => {
  test.setTimeout(120000);
  const first = await startServer(), second = await startServer();
  const build = await createExtension('chrome');
  let context;
  const requests = [];
  first.server.on('request', request => requests.push({ site: 'Home', path: request.url, key: request.headers['x-api-key'] }));
  second.server.on('request', request => requests.push({ site: 'Family', path: request.url, key: request.headers['x-api-key'] }));
  try {
    context = await chromium.launchPersistentContext(path.join(build.temporary, 'profile'), {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${build.extension}`, `--load-extension=${build.extension}`]
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    const manager = await context.newPage();
    await manager.goto('chrome://extensions');
    await manager.evaluate(id => chrome.developerPrivate.addHostPermission(id, 'http://127.0.0.1/*'), id);
    await manager.close();
    const options = await context.newPage();
    await options.setViewportSize({ width: 320, height: 700 });
    await options.goto(`chrome-extension://${id}/src/options/options.html`);
    await expect(options.locator('#ratingsCacheCount')).toHaveText('No ratings cached');
    await options.locator('#seerrSiteName').fill('Home');
    await options.locator('#serverUrl').fill(first.origin);
    await options.locator('#apiKey').fill('initial-home-key');
    await options.locator('button[type=submit]').click();
    await expect(options.locator('#activeSeerrSite')).toContainText('Active site: Home');
    // Once a named site exists, clearing its name must still edit the saved
    // profile rather than writing an ignored legacy key.
    await options.locator('#seerrSiteName').fill('');
    await options.locator('#apiKey').fill('home-key');
    await options.locator('button[type=submit]').click();
    await expect(options.locator('#activeSeerrSite')).toContainText('Active site: 127.0.0.1');
    await options.locator('#seerrSiteName').fill('Home');
    await options.locator('button[type=submit]').click();
    await expect(options.locator('#activeSeerrSite')).toContainText('Active site: Home');
    await options.getByRole('button', { name: 'Add another site', exact: true }).click();
    await expect(options.locator('#apiKey')).toHaveValue('');
    await options.locator('#seerrSiteName').fill('Family');
    await options.locator('#serverUrl').fill(second.origin);
    await options.locator('#apiKey').fill('family-key');
    await options.locator('button[type=submit]').click();
    await expect(options.locator('#activeSeerrSite')).toContainText('Active site: Family');
    await expect(options.locator('#savedSeerrSites option')).toHaveCount(2);
    await options.getByRole('button', { name: 'Test Connection', exact: true }).click();
    await expect(options.locator('#status')).toContainText('Connected');
    expect(requests.filter(r => r.path === '/api/v1/auth/me').at(-1)).toMatchObject({ site: 'Family', key: 'family-key' });
    const familyRequest = await options.evaluate(async () => chrome.runtime.sendMessage({ action: 'requestMedia', data: { tmdbId: 550, mediaType: 'movie', title: 'Fight Club' } }));
    expect(familyRequest.success).toBe(true);
    const seerr = await context.newPage();
    await seerr.goto(`${second.origin}/discover`);
    await expect(seerr.locator('.seerr-card-badge')).toHaveCount(2);
    expect(await options.locator('.connection-options').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await options.locator('.connection-options').screenshot({ path: '/tmp/super-seerr-multiple-sites-settings.png' });

    const popup = await context.newPage();
    await popup.setViewportSize({ width: 320, height: 400 });
    await popup.goto(`chrome-extension://${id}/src/popup/popup.html`);
    await expect(popup.locator('#activeSeerrSite')).toHaveValue(second.origin);
    await popup.locator('#activeSeerrSite').selectOption(first.origin);
    await expect(popup.locator('#siteSwitchStatus')).toContainText('Site switched');
    await expect(popup.locator('#diagnosticChecks')).toContainText('API key: OK');
    const result = await popup.evaluate(async () => chrome.runtime.sendMessage({ action: 'testConnection' }));
    expect(result.success).toBe(true);
    expect(requests.filter(r => r.path === '/api/v1/auth/me').at(-1)).toMatchObject({ site: 'Home', key: 'home-key' });
    await expect(seerr.locator('.seerr-card-badge')).toHaveCount(0);
    const homeRequest = await popup.evaluate(async () => chrome.runtime.sendMessage({ action: 'requestMedia', data: { tmdbId: 550, mediaType: 'movie', title: 'Fight Club' } }));
    expect(homeRequest.success).toBe(true);
    await popup.screenshot({ path: '/tmp/super-seerr-multiple-sites-popup.png' });

    // Reload proves the worker-owned record, not a form draft, holds the key.
    await options.reload();
    await expect(options.locator('#apiKey')).toHaveValue('home-key');
    await options.locator('#savedSeerrSites').selectOption(second.origin);
    await expect(options.locator('#apiKey')).toHaveValue('family-key');
    await options.getByRole('button', { name: 'Use selected site', exact: true }).click();
    await expect(options.locator('#activeSeerrSite')).toContainText('Active site: Family');
    await options.locator('#savedSeerrSites').selectOption(first.origin);
    await options.getByRole('button', { name: 'Remove selected site', exact: true }).click();
    await expect(options.locator('#savedSeerrSites option')).toHaveCount(1);
    await expect(options.locator('#activeSeerrSite')).toContainText('Active site: Family');
    const storage = await options.evaluate(async () => ({ sync: await chrome.storage.sync.get(null), local: await chrome.storage.local.get('seerrConnectionsV1') }));
    expect(JSON.stringify(storage.sync)).not.toContain('-key');
    expect(JSON.stringify(storage.local)).not.toContain('home-key');
    expect(requests.filter(r => r.key && ((r.site === 'Home' && !['home-key', 'initial-home-key'].includes(r.key)) || (r.site === 'Family' && r.key !== 'family-key')))).toEqual([]);
  } finally {
    await context?.close();
    await Promise.all([new Promise(resolve => first.server.close(resolve)), new Promise(resolve => second.server.close(resolve))]);
    await fs.rm(build.temporary, { recursive: true, force: true });
  }
});

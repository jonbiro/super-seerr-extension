const { test, expect, chromium } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { createExtension } = require('./fixture.cjs');

test('installed popup rejects proxy success pages and recovers through setup and account checks', async () => {
  let mode = 'html';
  const server = http.createServer((request, response) => {
    if (request.url === '/api/v1/settings/public') {
      response.setHeader('Content-Type', mode === 'html' ? 'text/html' : 'application/json');
      response.end(mode === 'html' ? '<html>Proxy sign-in</html>' : JSON.stringify({ initialized: mode !== 'setup' }));
    } else if (request.url.startsWith('/api/v1/request?')) {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ results: [] }));
    } else if (request.url === '/api/v1/movie/550') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ id: 550, mediaInfo: { status: 5 } }));
    } else {
      if (mode === 'auth-offline' && request.url === '/api/v1/auth/me') response.statusCode = 503;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(mode === 'bad-account' ? { message: 'Proxy fallback' } : { id: 1 }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const build = await createExtension('chrome');
  let context;
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
    await options.goto(`chrome-extension://${id}/src/options/options.html`);
    await options.locator('#serverUrl').fill(origin);
    await options.locator('button[type=submit]').click();
    await expect(options.locator('#activeSeerrSite')).toContainText(origin);
    await options.evaluate(origin => chrome.storage.local.set({ recentActionsV1: [{ kind: 'request', title: 'Fixture film', mediaType: 'movie', tmdbId: 550, at: 1, server: `${origin}/` }] }), origin);
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 320, height: 400 });
    await popup.goto(`chrome-extension://${id}/src/popup/popup.html`);
    await expect(popup.locator('#diagnosticChecks')).toContainText('expected Seerr settings');
    await expect(popup.locator('.status-text')).toHaveText('Connection needs attention');
    await expect(popup.getByRole('button', { name: 'Fix seerr connection', exact: true })).toBeVisible();
    await expect(popup.locator('.recent-action-state')).toHaveText('Status unavailable');
    mode = 'setup';
    await popup.getByRole('button', { name: 'Check connections', exact: true }).click();
    await expect(popup.locator('#diagnosticChecks')).toContainText('initial setup is incomplete');
    await expect(popup.locator('.status-text')).toHaveText('Connection needs attention');
    mode = 'ready';
    await popup.getByRole('button', { name: 'Check connections', exact: true }).click();
    await expect(popup.locator('.status-text')).toHaveText('Ratings-only mode');
    mode = 'bad-account';
    await options.locator('#apiKey').fill('test-key');
    await options.locator('button[type=submit]').click();
    await expect(options.locator('#status')).toContainText('Settings saved successfully');
    await expect(popup.locator('#diagnosticChecks')).toContainText('unexpected account response');
    await expect(popup.locator('.recent-action-state')).toHaveText('Available');
    await expect(popup.locator('.status-text')).toHaveText('Connection needs attention');
    await expect(popup.locator('#configuredHeading')).toHaveText('Check your API key');
    await expect(popup.locator('#configuredDetail')).not.toContainText('Add an API key');
    mode = 'ready';
    await popup.getByRole('button', { name: 'Check connections', exact: true }).click();
    await expect(popup.locator('.status-text')).toHaveText('Ready to request');
    await expect(popup.locator('#diagnosticChecks')).toContainText('API key: OK');
    await expect(popup.locator('#testConnection svg')).toHaveCount(1);
    mode = 'auth-offline';
    await popup.getByRole('button', { name: 'Check connections', exact: true }).click();
    await expect(popup.locator('#diagnosticChecks')).toContainText('Could not verify the API key');
    await expect(popup.locator('.status-text')).toHaveText('Connection needs attention');
    await expect(popup.locator('#configuredHeading')).toHaveText('Check your API key');
    await expect(popup.locator('#configuredDetail')).toContainText('saved API key is not verified');
    mode = 'ready';
    await popup.getByRole('button', { name: 'Check connections', exact: true }).click();
    await expect(popup.locator('#configuredHeading')).toHaveText('Ready to request');
    await options.locator('#apiKey').fill('');
    await options.locator('button[type=submit]').click();
    await expect(popup.locator('.status-text')).toHaveText('Ratings-only mode');
    await expect(popup.locator('.recent-action-state')).toHaveText('Status unavailable');
    // Revoke and restore the real optional permission while the popup stays open.
    await options.evaluate(() => chrome.permissions.remove({ origins: ['http://127.0.0.1/*'] }));
    await expect(popup.locator('#diagnosticChecks')).toContainText('Seerr host access is missing');
    await expect(popup.locator('.status-text')).toHaveText('Connection needs attention');
    const permissionsPage = await context.newPage();
    await permissionsPage.goto('chrome://extensions');
    await permissionsPage.evaluate(id => chrome.developerPrivate.addHostPermission(id, 'http://127.0.0.1/*'), id);
    await options.locator('button[type=submit]').click();
    await expect(popup.locator('.status-text')).toHaveText('Ratings-only mode');
    await permissionsPage.close();
  } finally {
    await context?.close();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(build.temporary, { recursive: true, force: true });
  }
});

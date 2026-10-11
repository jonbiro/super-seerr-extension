const { test, expect, chromium } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createExtension, startServer } = require('./fixture.cjs');

test('a live discovery panel switches site-specific saved choices before sending requests', async () => {
  test.setTimeout(60000);
  const home = await startServer(), family = await startServer();
  const build = await createExtension('chrome');
  let context;
  const posts = [];
  for (const [site, fixture] of [['Home', home], ['Family', family]]) {
    fixture.server.on('request', request => {
      if (request.method !== 'POST' || request.url !== '/api/v1/request') return;
      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => posts.push({ site, key: request.headers['x-api-key'], ...JSON.parse(body) }));
    });
  }
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
    for (const [url, name, tmdbId] of [[home.origin, 'Home', 910], [family.origin, 'Family', 911]]) {
      if (name === 'Family') await options.getByRole('button', { name: 'Add another site', exact: true }).click();
      await options.locator('#seerrSiteName').fill(name);
      await options.locator('#serverUrl').fill(url);
      await options.locator('#apiKey').fill(`${name.toLowerCase()}-key`);
      await options.locator('button[type=submit]').click();
      await expect(options.locator('#activeSeerrSite')).toContainText(`Active site: ${name}`);
      const saved = await options.evaluate(tmdbId => chrome.runtime.sendMessage({ action: 'saveTitleCorrection',
        data: { original: { title: 'The Thing', mediaType: 'movie', imdbId: 'tt0007777' }, tmdbId } }), tmdbId);
      expect(saved.success, saved.error).toBe(true);
    }
    const activate = url => options.evaluate(url => chrome.runtime.sendMessage({ action: 'activateSeerrConnection', data: { id: url } }), url);
    expect((await activate(home.origin)).success).toBe(true);
    const page = await context.newPage();
    await page.bringToFront();
    await page.setViewportSize({ width: 320, height: 568 });
    await page.route('**/*', route => route.request().isNavigationRequest()
      ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>The Thing - IMDb</title><h1 data-testid="hero-title-block__title">The Thing</h1>' })
      : route.abort());
    await page.goto('https://www.imdb.com/title/tt0007777/', { waitUntil: 'load' });
    // The packaged content scripts still need to resolve the saved match.
    await expect(page.locator('.seerr-year')).toHaveText('1982 • Movie', { timeout: 10000 });
    await page.getByRole('button', { name: 'Open Super Seerr', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Request on Seerr', exact: true })).toBeVisible({ timeout: 10000 });
    expect((await activate(family.origin)).success).toBe(true);
    await expect(page.locator('.seerr-year')).toHaveText('2011 • Movie');
    await expect(page.locator('.seerr-connection-label')).toContainText(new URL(family.origin).host);
    await page.getByRole('button', { name: 'Open Super Seerr', exact: true }).click();
    // Rendering the new site's identity precedes its asynchronous status read.
    await expect(page.getByRole('button', { name: 'Request on Seerr', exact: true })).toBeEnabled({ timeout: 10000 });
    expect(await page.locator('.seerr-panel').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(posts).toHaveLength(0);
    await page.getByRole('button', { name: 'Request on Seerr', exact: true }).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toMatchObject({ site: 'Family', key: 'family-key', mediaId: 911, mediaType: 'movie' });
    expect((await activate(home.origin)).success).toBe(true);
    await expect(page.locator('.seerr-year')).toHaveText('1982 • Movie');
    await expect(page.locator('.seerr-connection-label')).toContainText(new URL(home.origin).host);
    await page.getByRole('button', { name: 'Open Super Seerr', exact: true }).click();
    await page.getByRole('button', { name: 'Request on Seerr', exact: true }).click();
    await expect.poll(() => posts.length).toBe(2);
    expect(posts[1]).toMatchObject({ site: 'Home', key: 'home-key', mediaId: 910, mediaType: 'movie' });
    await page.reload();
    await expect(page.locator('.seerr-year')).toHaveText('1982 • Movie');
    expect(posts).toHaveLength(2);
  } finally {
    await context?.close();
    await Promise.all([home, family].map(fixture => new Promise(resolve => fixture.server.close(resolve))));
    await fs.rm(build.temporary, { recursive: true, force: true });
  }
});

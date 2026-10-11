const { test, expect, chromium } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createExtension } = require('./fixture.cjs');

test('full saved-site list explains capacity and still permits editing and removal at 320px', async () => {
  const build = await createExtension('chrome');
  let context;
  try {
    context = await chromium.launchPersistentContext(path.join(build.temporary, 'profile'), {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${build.extension}`, `--load-extension=${build.extension}`]
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    await worker.evaluate(async () => {
      const sites = Array.from({ length: 10 }, (_, i) => ({
        id: `https://site-${i}.example`, url: `https://site-${i}.example`, name: `Site ${i}`, apiKey: `fixture-key-${i}`
      }));
      await chrome.storage.local.set({ seerrConnectionsV1: { revision: 1, activeId: sites[0].id, sites } });
    });
    const options = await context.newPage();
    await options.setViewportSize({ width: 320, height: 800 });
    await options.goto(`chrome-extension://${id}/src/options/options.html`);
    const capacity = options.locator('#seerrSitesCapacity');
    await expect(capacity).toHaveText('10 of 10 sites saved. Remove an inactive site before adding another.');
    await expect(options.locator('#addSeerrSite')).toBeDisabled();
    await options.locator('#savedSeerrSites').selectOption('https://site-9.example');
    await expect(options.locator('#apiKey')).toHaveValue('fixture-key-9');
    await expect(options.locator('#useSeerrSite')).toBeEnabled();
    await expect(options.locator('#removeSeerrSite')).toBeEnabled();
    const bounds = await capacity.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
    await options.locator('#removeSeerrSite').click();
    await expect(capacity).toHaveText('9 of 10 sites saved.');
    await expect(options.locator('#addSeerrSite')).toBeEnabled();
    await expect(options.locator('#apiKey')).toHaveValue('fixture-key-0');
    await options.locator('#addSeerrSite').click();
    await expect(options.locator('#serverUrl')).toHaveValue('');
    await expect(options.locator('#apiKey')).toHaveValue('');
  } finally {
    await context?.close();
    await fs.rm(build.temporary, { recursive: true, force: true });
  }
});

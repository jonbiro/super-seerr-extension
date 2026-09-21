const { test, expect, chromium } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createExtension, startServer } = require('./fixture.cjs');

test('real 3.5.2 to current upgrade retains settings, migrates legacy keys, and updates registered scripts', async () => {
  const old = await createExtension('chrome', { ref: '4864269' });
  const current = await createExtension('chrome');
  const { server, origin } = await startServer();
  let context;
  try {
    expect(old.manifest.version).toBe('3.5.2');
    context = await chromium.launchPersistentContext(path.join(old.temporary, 'profile'), {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${old.extension}`, `--load-extension=${old.extension}`]
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    let options = await context.newPage();
    await options.goto(`chrome-extension://${id}/src/options/options.html`);
    const manager = await context.newPage(); await manager.goto('chrome://extensions');
    await manager.evaluate(id => chrome.developerPrivate.addHostPermission(id, 'http://127.0.0.1/*'), id);
    await options.locator('#serverUrl').fill(origin); await options.locator('#apiKey').fill('baseline-key');
    await options.locator('button[type="submit"]').click();
    await expect.poll(() => options.evaluate(() => chrome.permissions.contains({ origins: ['http://127.0.0.1/*'] }))).toBe(true);
    // Legacy synced fields are deliberately introduced after baseline startup;
    // the new worker must migrate them during the actual addon upgrade.
    await options.evaluate(async origin => {
      await chrome.storage.sync.set({ seerrUrl: origin, jellyseerrUrl: origin, jellyseerrApiKey: 'legacy-upgrade-key', overlayFeatures: { cardBadges: false },
        seerrFilterPresetsV1: [{ name: 'Keep me', sort: 'rt-critics-desc', filters: { minCritics: 70 } }] });
      await chrome.storage.local.remove('seerrApiKey');
      await chrome.storage.local.set({ plexToken: 'saved-plex-token', debugLogging: false });
    }, origin);
    // Reloading an unpacked addon requires Developer mode in the isolated profile.
    await manager.evaluate(() => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }));
    await fs.cp(current.extension, old.extension, { recursive: true });
    await manager.evaluate(id => new Promise((resolve, reject) => chrome.developerPrivate.reload(id, { failQuietly: false }, () => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve())), id);
    await expect.poll(() => manager.evaluate(async id => {
      const items = await chrome.developerPrivate.getExtensionsInfo({});
      return items.find(item => item.id === id);
    }, id)).toMatchObject({ version: current.manifest.version, state: 'ENABLED' });
    options = await context.newPage();
    await options.goto(`chrome-extension://${id}/src/options/options.html`);
    const saved = await options.evaluate(async () => {
      await chrome.runtime.sendMessage({ action: 'ping' });
      return { version: chrome.runtime.getManifest().version,
        sync: await chrome.storage.sync.get(['seerrUrl', 'jellyseerrUrl', 'jellyseerrApiKey', 'seerrApiKey', 'overlayFeatures', 'seerrFilterPresetsV1']),
        local: await chrome.storage.local.get(['seerrApiKey', 'plexToken']),
        scripts: await chrome.scripting.getRegisteredContentScripts(),
        permission: await chrome.permissions.contains({ origins: ['http://127.0.0.1/*'] }) };
    });
    expect(saved.version).toBe(current.manifest.version);
    expect(saved.sync.seerrUrl).toBe(origin);
    expect(saved.sync.overlayFeatures.cardBadges).toBe(false);
    expect(saved.sync.seerrFilterPresetsV1[0].name).toBe('Keep me');
    expect(saved.sync.jellyseerrUrl).toBeUndefined(); expect(saved.sync.jellyseerrApiKey).toBeUndefined(); expect(saved.sync.seerrApiKey).toBeUndefined();
    expect(saved.local).toEqual({ seerrApiKey: 'legacy-upgrade-key', plexToken: 'saved-plex-token' });
    expect(saved.permission).toBe(true);
    expect(saved.scripts.find(script => script.id === 'seerr-overlay').js.some(file => file.endsWith('SeasonPicker.js'))).toBe(true);
    const page = await context.newPage(); await page.goto(`${origin}/discover`);
    await expect(page.locator('#seerr-filter-bar')).toBeVisible();
    await expect(page.locator('.seerr-card-badge')).toHaveCount(0);
    await options.evaluate(() => chrome.storage.sync.set({ overlayFeatures: { cardBadges: true } }));
    await expect(page.locator('.seerr-card-badge')).toHaveCount(2);
  } finally {
    await context?.close(); await new Promise(resolve => server.close(resolve));
    await fs.rm(old.temporary, { recursive: true, force: true });
    await fs.rm(current.temporary, { recursive: true, force: true });
  }
});

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const html = fs.readFileSync('src/options/options.html', 'utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, '');
  await page.setContent(html);
  await page.addStyleTag({ path: path.resolve('src/options/options.css') });
  await page.evaluate(() => {
    window.chrome = {
      storage: { sync: { get: async () => ({}) }, local: { get: async () => ({}) } },
      permissions: { contains: async () => false }, runtime: { sendMessage: async () => ({ success: true, data: { sites: [], activeId: null } }) }
    };
  });
  await page.addScriptTag({ content: fs.readFileSync('src/options/options.js', 'utf8').split('// Initialize when DOM is loaded')[0] + '\nwindow.optionsManager = new OptionsManager();' });
  await expect(page.locator('#ratingsCacheCount')).toHaveText('No ratings cached');
});

test('revealing either credential preserves its full-size input and value', async ({ page }) => {
  for (const [id, name] of [['apiKey', 'Seerr API key'], ['plexToken', 'Plex token']]) {
    const field = page.locator(`#${id}`);
    await field.fill('test-value-'.repeat(20));
    // This fixture loads CSS after the markup, so let its initial style
    // transitions settle before comparing masked and revealed dimensions.
    await field.evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished)));
    const before = await field.boundingBox();
    await page.getByRole('button', { name: `Show ${name}`, exact: true }).click();
    await expect(field).toHaveAttribute('type', 'text');
    const after = await field.boundingBox();
    expect(after.width).toBeCloseTo(before.width, 1);
    expect(after.height).toBeCloseTo(before.height, 1);
    await expect(field).toHaveValue('test-value-'.repeat(20));
    await expect(field).toHaveCSS('border-radius', '8px');
    await field.focus();
    await expect(field).toHaveCSS('border-color', 'rgb(124, 58, 237)');
    await page.getByRole('button', { name: `Hide ${name}`, exact: true }).click();
    await expect(field).toHaveAttribute('type', 'password');
  }
});

test('settings hints and controls fit a narrow viewport without being clipped', async ({ page }) => {
  const overflow = await page.evaluate(() => [...document.querySelectorAll('input, fieldset, .plex-help code, .button')]
    .filter(node => { const r = node.getBoundingClientRect(); return r.width && (r.left < 0 || r.right > innerWidth); })
    .map(node => node.id || node.tagName));
  expect(overflow).toEqual([]);
});

test('saved-site failures offer a narrow-layout retry without discarding unsaved fields', async ({ page }) => {
  await page.evaluate(async () => {
    const data = { revision: 1, activeId: 'home', sites: [
      { id: 'home', name: 'Home', url: 'https://home.example/' },
      { id: 'family', name: 'Family', url: 'https://family.example/' }
    ] };
    chrome.runtime.sendMessage = async () => ({ success: true, data });
    window.optionsManager.connectionId = 'family';
    await window.optionsManager.loadConnectionChoices();
    chrome.runtime.sendMessage = async () => ({ success: false, error: 'Temporary failure' });
    await window.optionsManager.loadConnectionChoices();
    window.siteRecoveryReply = data;
  });
  await page.locator('#apiKey').fill('unsaved-family-key');
  await expect(page.locator('#seerrSitesError')).toBeVisible();
  await expect(page.locator('#useSeerrSite')).toBeDisabled();
  await expect(page.locator('#removeSeerrSite')).toBeDisabled();
  const retry = page.getByRole('button', { name: 'Retry saved sites', exact: true });
  await expect(retry).toBeEnabled();
  expect(await page.locator('.connection-options').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.locator('.connection-options').screenshot({ path: '/tmp/super-seerr-site-refresh-recovery.png' });
  await page.evaluate(() => { chrome.runtime.sendMessage = async () => ({ success: true, data: window.siteRecoveryReply }); });
  await retry.click();
  await expect(page.locator('#seerrSitesError')).toBeHidden();
  await expect(page.locator('#useSeerrSite')).toBeEnabled();
  await expect(page.locator('#removeSeerrSite')).toBeEnabled();
  await expect(page.locator('#savedSeerrSites')).toHaveValue('family');
  await expect(page.locator('#apiKey')).toHaveValue('unsaved-family-key');
});

test('a site-list refresh keeps the pending selection aligned with the loaded credentials', async ({ page }) => {
  await page.evaluate(async () => {
    const data = { revision: 1, activeId: 'home', sites: [
      { id: 'home', name: 'Home', url: 'https://home.example/', apiKey: 'home-key' },
      { id: 'family', name: 'Family', url: 'https://family.example/', apiKey: 'family-key' }
    ] };
    chrome.runtime.sendMessage = async () => ({ success: true, data });
    chrome.storage.local.get = async () => ({ seerrConnectionsV1: data });
    await optionsManager.loadSettings();
    await optionsManager.loadConnectionChoices();
    chrome.storage.local.get = () => new Promise(resolve => { window.releaseSiteRead = () => resolve({ seerrConnectionsV1: data }); });
  });
  await page.locator('#savedSeerrSites').selectOption('family');
  await expect(page.locator('#savedSeerrSites')).toBeDisabled();
  await page.evaluate(() => optionsManager.loadConnectionChoices());
  await expect(page.locator('#savedSeerrSites')).toHaveValue('family');
  await expect(page.locator('#useSeerrSite')).toBeDisabled();
  await page.evaluate(() => releaseSiteRead());
  await expect(page.locator('#savedSeerrSites')).toBeEnabled();
  await expect(page.locator('#savedSeerrSites')).toHaveValue('family');
  await expect(page.locator('#serverUrl')).toHaveValue('https://family.example/');
  await expect(page.locator('#apiKey')).toHaveValue('family-key');
  await expect(page.locator('#apiKey')).toHaveAttribute('type', 'password');
  await expect(page.locator('#useSeerrSite')).toBeEnabled();
});

test('edits made during a pending site save remain visibly unsaved', async ({ page }) => {
  await page.evaluate(() => {
    window.savedDraftWrites = [];
    chrome.permissions.request = async () => true;
    chrome.storage.sync.set = async value => { savedDraftWrites.push(value); };
    chrome.storage.local.set = async value => { savedDraftWrites.push(value); };
    chrome.runtime.sendMessage = async message => {
      if (message.action === 'saveSeerrConnection') return new Promise(resolve => {
        window.finishDraftSave = () => resolve({ success: true, data: { activeId: message.data.url } });
      });
      return { success: true, data: { revision: 1, activeId: 'https://home.example', sites: [{ id: 'https://home.example', name: 'Home', url: 'https://home.example' }] } };
    };
  });
  await page.locator('#serverUrl').fill('https://home.example');
  await page.locator('#seerrSiteName').fill('Home');
  const feature = page.locator('[data-overlay-feature]').first();
  await feature.check();
  await page.locator('button[type=submit]').click();
  await page.waitForFunction(() => typeof window.finishDraftSave === 'function');
  await page.locator('#apiKey').fill('newer-unsaved-key');
  await feature.uncheck();
  await page.locator('#debugLogging').check();
  await page.evaluate(() => finishDraftSave());
  await expect(page.locator('#status')).toContainText('Your newer edits are not saved yet');
  await expect(page.locator('#apiKey')).toHaveValue('newer-unsaved-key');
  await expect(feature).not.toBeChecked();
  const key = await feature.getAttribute('data-overlay-feature');
  expect(await page.evaluate(key => savedDraftWrites.find(write => write.overlayFeatures).overlayFeatures[key], key)).toBe(true);
  expect(await page.evaluate(() => savedDraftWrites.find(write => 'debugLogging' in write).debugLogging)).toBe(false);
});

for (const [success, destination] of [[true, 'search'], [true, 'outside'], [true, 'other-match'], [false, 'retry']]) test(`forgetting a saved match preserves nearby controls (${destination})`, async ({ page }) => {
  await page.evaluate(() => {
    window.matchRows = ['First', 'Second'].map((title, index) => ({
      key: JSON.stringify(['https://seerr.example/', 'movie', title]), title, selectedTitle: title,
      mediaType: 'movie', year: 2000, tmdbId: index + 1
    }));
    chrome.runtime.sendMessage = async ({ action }) => {
      if (action === 'removeTitleCorrection') return new Promise(resolve => { window.finishRemoval = resolve; });
      return { success: true, data: window.matchRows };
    };
  });
  await page.addScriptTag({ path: path.resolve('src/options/support-tools.js') });
  await page.getByRole('button', { name: 'Inspect saved title matches', exact: true }).click();
  const first = page.locator('.support-tools li').filter({ hasText: 'First' });
  const second = page.locator('.support-tools li').filter({ hasText: 'Second' });
  await second.locator('summary').click();
  await first.getByRole('button', { name: 'Forget match' }).focus();
  await page.keyboard.press('Enter');
  await expect(first.getByRole('button', { name: 'Forget match' })).toBeDisabled();
  if (destination === 'outside') await page.getByRole('button', { name: 'Prepare diagnostic report' }).focus();
  if (destination === 'other-match') await second.locator('summary').focus();
  await page.evaluate(success => window.finishRemoval({ success }), success);
  await expect(second.locator('details')).toHaveAttribute('open', '');
  if (success) await expect(first).toHaveCount(0);
  else await expect(first.getByRole('button', { name: 'Forget match' })).toBeEnabled();
  const focused = destination === 'outside' ? page.getByRole('button', { name: 'Prepare diagnostic report' })
    : destination === 'other-match' ? second.locator('summary')
      : destination === 'retry' ? first.getByRole('button', { name: 'Forget match' })
        : page.getByRole('searchbox', { name: 'Search saved matches' });
  await expect(focused).toBeFocused();
});

test('removing a site does not reveal the active site key in a previously revealed field', async ({ page }) => {
  await page.evaluate(async () => {
    window.profiles = { revision: 1, activeId: 'home', sites: [
      { id: 'home', name: 'Home', url: 'https://home.example', apiKey: 'home-fixture-key' },
      { id: 'family', name: 'Family', url: 'https://family.example', apiKey: 'family-fixture-key' }
    ] };
    chrome.storage.local.get = async () => ({ seerrConnectionsV1: profiles });
    chrome.runtime.sendMessage = async ({ action, data }) => {
      if (action === 'removeSeerrConnection') profiles = { ...profiles, revision: 2, sites: profiles.sites.filter(site => site.id !== data.id) };
      return { success: true, data: profiles };
    };
    await optionsManager.loadSettings(); await optionsManager.loadConnectionChoices();
  });
  await page.locator('#savedSeerrSites').selectOption('family');
  await expect(page.locator('#apiKey')).toHaveValue('family-fixture-key');
  await page.getByRole('button', { name: 'Show Seerr API key', exact: true }).click();
  await expect(page.locator('#apiKey')).toHaveAttribute('type', 'text');
  await page.locator('#removeSeerrSite').click();
  await expect(page.locator('#apiKey')).toHaveValue('home-fixture-key');
  await expect(page.locator('#apiKey')).toHaveAttribute('type', 'password');
  await expect(page.getByRole('button', { name: 'Show Seerr API key', exact: true })).toHaveText('Show');
});

for (const [id, name, storageKey] of [['apiKey', 'Seerr API key', 'seerrApiKey'], ['plexToken', 'Plex token', 'plexToken']]) {
  test(`reloading a changed ${name} conceals it but an unchanged credential stays revealed`, async ({ page }) => {
    await page.evaluate(async storageKey => {
      window.credentials = { [storageKey]: 'first-fixture-secret' };
      chrome.storage.local.get = async () => credentials;
      await optionsManager.loadSettings();
    }, storageKey);
    const field = page.locator(`#${id}`);
    await page.getByRole('button', { name: `Show ${name}`, exact: true }).click();
    await page.evaluate(() => optionsManager.loadSettings());
    await expect(field).toHaveAttribute('type', 'text');
    await page.evaluate(async storageKey => {
      credentials[storageKey] = 'second-fixture-secret'; await optionsManager.loadSettings();
    }, storageKey);
    await expect(field).toHaveValue('second-fixture-secret');
    await expect(field).toHaveAttribute('type', 'password');
    await expect(page.getByRole('button', { name: `Show ${name}`, exact: true })).toHaveText('Show');
  });
}

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

for (const outcome of ['success', 'failure']) test(`Settings protects its initial draft until saved values ${outcome}`, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const html = fs.readFileSync('src/options/options.html', 'utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, '');
  await page.setContent(html);
  await page.addStyleTag({ path: path.resolve('src/options/options.css') });
  await page.evaluate(() => {
    location.hash = 'apiKey';
    window.chrome = {
      storage: { onChanged: { addListener() {} }, sync: { get: async () => ({ seerrUrl: 'https://home.example/' }) },
        local: { get: () => new Promise((resolve, reject) => { window.finishInitialRead = success => {
          chrome.storage.local.get = async () => ({ seerrApiKey: 'home-key' });
          if (success) resolve({ seerrApiKey: 'home-key' });
          else reject(new Error('Temporary read failure'));
        }; }) } },
      permissions: { contains: async () => true },
      runtime: { sendMessage: async () => ({ success: true, data: { sites: [], activeId: null } }) }
    };
  });
  await page.addScriptTag({ content: fs.readFileSync('src/options/options.js', 'utf8').split('// Initialize when DOM is loaded')[0] + '\nwindow.manager = new OptionsManager();' });
  for (const id of ['serverUrl', 'apiKey', 'seerrSiteName', 'plexToken', 'debugLogging', 'savedSeerrSites']) {
    await expect(page.locator(`#${id}`)).toBeDisabled();
  }
  await expect(page.locator('button[type=submit]')).toBeDisabled();
  await expect(page.locator('#settingsForm')).toHaveAttribute('aria-busy', 'true');
  await page.evaluate(success => finishInitialRead(success), outcome === 'success');
  await expect(page.locator('#settingsForm')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#apiKey')).toBeEnabled();
  await expect(page.locator('#apiKey')).toBeFocused();
  await expect(page.locator('button[type=submit]')).toBeEnabled();
  if (outcome === 'success') {
    await expect(page.locator('#serverUrl')).toHaveValue('https://home.example/');
    await expect(page.locator('#apiKey')).toHaveValue('home-key');
    await expect(page.locator('#apiKey')).toHaveAttribute('type', 'password');
  } else await expect(page.locator('#status')).toContainText('Failed to load settings');
  await page.locator('#apiKey').fill('new-draft-key');
  await expect(page.locator('#apiKey')).toHaveValue('new-draft-key');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

for (const success of [true, false]) test(`selecting a saved site clears an obsolete test reply (success: ${success})`, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const html = fs.readFileSync('src/options/options.html', 'utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, '');
  await page.setContent(html);
  await page.addStyleTag({ path: path.resolve('src/options/options.css') });
  await page.evaluate(() => {
    window.profiles = { revision: 1, activeId: 'home', sites: [
      { id: 'home', name: 'Home', url: 'https://home.example/', apiKey: 'home-key' },
      { id: 'family', name: 'Family', url: 'https://family.example/', apiKey: 'family-key' }
    ] };
    window.chrome = {
      storage: { onChanged: { addListener() {} }, sync: { get: async () => ({}) },
        local: { get: async () => ({ seerrConnectionsV1: profiles }) } },
      permissions: { contains: async () => true, request: async () => true },
      runtime: { sendMessage: message => message.action === 'testConnection'
        ? new Promise(resolve => { window.finishTest = resolve; })
        : Promise.resolve({ success: true, data: profiles }) }
    };
  });
  await page.addScriptTag({ content: fs.readFileSync('src/options/options.js', 'utf8').split('// Initialize when DOM is loaded')[0] + '\nwindow.manager = new OptionsManager();' });
  await expect(page.locator('#apiKey')).toHaveValue('home-key');
  await page.locator('#testConnection').click();
  await page.waitForFunction(() => typeof window.finishTest === 'function');
  await page.evaluate(() => {
    chrome.storage.local.get = () => new Promise(resolve => { window.finishRead = () => {
      chrome.storage.local.get = async () => ({ seerrConnectionsV1: profiles });
      resolve({ seerrConnectionsV1: profiles });
    }; });
  });
  await page.locator('#savedSeerrSites').selectOption('family');
  await expect(page.locator('#status')).toContainText('Loading saved site');
  await page.evaluate(success => finishTest(success ? { success: true, data: { user: 'Old home account' } }
    : { success: false, error: 'Old home failure' }), success);
  await expect(page.locator('#testConnection')).toBeDisabled();
  await expect(page.locator('#status')).toContainText('Loading saved site');
  await page.evaluate(() => finishRead());
  await expect(page.locator('#apiKey')).toHaveValue('family-key');
  await expect(page.locator('#status')).toContainText('Saved site loaded');
  await expect(page.locator('#testConnection')).toBeEnabled();
  await expect(page.locator('#testPlexConnection')).toBeEnabled();
  await expect(page.locator('#status')).not.toContainText('Old home');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

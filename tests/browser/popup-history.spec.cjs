const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 400 });
  const html = fs.readFileSync('src/popup/popup.html', 'utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, '');
  await page.setContent(html);
  await page.addStyleTag({ path: path.resolve('src/popup/popup.css') });
});

test('cleared history stays gone after a failed reload and Refresh can recover', async ({ page }) => {
  await page.evaluate(() => {
    let cleared = false;
    window.historyReadFails = true;
    window.chrome = { runtime: { sendMessage: async ({ action }) => {
      if (action === 'clearRecentActions') { cleared = true; return { success: true }; }
      if (cleared && window.historyReadFails) throw new Error('Worker disconnected');
      const entry = { kind: 'request', title: 'VeryLongTitle'.repeat(16), mediaType: 'movie', at: 1 };
      return { success: true, data: cleared ? [] : [{ ...entry, status: 'Request approved' }] };
    } } };
  });
  await page.addScriptTag({ path: path.resolve('src/popup/recent-actions.js') });
  await expect(page.locator('#recentActionsList li')).toContainText('Request approved');
  expect(await page.locator('#recentActionsList').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.getByRole('button', { name: 'Clear history', exact: true }).click();
  await expect(page.locator('#recentActionsList li')).toHaveCount(0);
  await expect(page.locator('#recentActionsStatus')).toContainText('Could not load history');
  await expect(page.getByRole('button', { name: 'Clear history', exact: true })).toBeDisabled();
  await page.evaluate(() => { window.historyReadFails = false; });
  await page.getByRole('button', { name: 'Refresh statuses', exact: true }).click();
  await expect(page.locator('#recentActionsStatus')).toHaveText('No confirmed actions yet.');
  await expect(page.getByRole('button', { name: 'Refresh statuses', exact: true })).toBeEnabled();
});

test('long connection status keeps the popup logo and status dot intact', async ({ page }) => {
  await page.evaluate(() => {
    window.chrome = { runtime: { sendMessage: async () => { throw new Error('Disconnected'); } } };
  });
  await page.addScriptTag({ path: path.resolve('src/popup/popup.js') });
  await expect(page.locator('.status-text')).toHaveText('Could not check connections');
  const dimensions = await page.locator('.popup-header').evaluate(header => {
    const logo = header.querySelector('.logo').getBoundingClientRect();
    const indicator = header.querySelector('.status-indicator').getBoundingClientRect();
    return {
      dot: header.querySelector('.status-dot').getBoundingClientRect().width,
      icon: header.querySelector('svg').getBoundingClientRect().width,
      gap: indicator.left - logo.right,
      overflow: header.scrollWidth > header.clientWidth
    };
  });
  expect(dimensions.dot).toBe(8);
  expect(dimensions.icon).toBe(24);
  expect(dimensions.gap).toBeGreaterThanOrEqual(8);
  expect(dimensions.overflow).toBe(false);
});

test('saved-site retry fits a narrow popup and restores focus to the recovered selector', async ({ page }) => {
  await page.evaluate(() => {
    window.chrome = { runtime: { sendMessage: async () => ({ success: false }) } };
  });
  await page.addScriptTag({ path: path.resolve('src/popup/connections.js') });
  const retry = page.getByRole('button', { name: 'Retry saved sites', exact: true });
  await expect(retry).toBeVisible();
  await expect(page.locator('#activeSeerrSite')).toBeDisabled();
  expect(await page.locator('#seerrSiteSwitcher').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.locator('#seerrSiteSwitcher').screenshot({ path: '/tmp/super-seerr-popup-site-retry.png' });
  await page.evaluate(() => {
    chrome.runtime.sendMessage = async () => ({ success: true, data: {
      revision: 1, activeId: 'home', sites: [{ id: 'home', name: 'Home', url: 'https://home.example' }]
    } });
  });
  await retry.click();
  await expect(retry).toBeHidden();
  await expect(page.locator('#activeSeerrSite')).toBeEnabled();
  await expect(page.locator('#activeSeerrSite')).toHaveValue('home');
  await expect(page.locator('#activeSeerrSite')).toBeFocused();
  await expect(page.locator('#siteSwitchStatus')).toBeEmpty();
});

for (const success of [true, false]) for (const moved of [false, true]) test(`site switching restores keyboard focus only when still owned (${success ? 'success' : 'failure'}, ${moved ? 'moved' : 'unchanged'})`, async ({ page }) => {
  await page.evaluate(() => {
    const sites = [{ id: 'home', name: 'Home', url: 'https://home.example' }, { id: 'family', name: 'Family', url: 'https://family.example' }];
    window.switchSites = sites;
    window.chrome = { permissions: { request: async () => true }, runtime: { sendMessage: async message => {
      if (message.action === 'activateSeerrConnection') return new Promise(resolve => { window.finishSwitch = resolve; });
      return { success: true, data: { revision: 1, activeId: 'home', sites } };
    } } };
  });
  await page.addScriptTag({ path: path.resolve('src/popup/connections.js') });
  const select = page.locator('#activeSeerrSite');
  await expect(select).toBeEnabled();
  await select.focus();
  await select.selectOption('family');
  await expect(select).toBeDisabled();
  if (moved) await page.locator('#openOptions').focus();
  await page.evaluate(success => window.finishSwitch(success
    ? { success: true, data: { revision: 2, activeId: 'family', sites: window.switchSites } }
    : { success: false, error: 'Switch failed' }), success);
  await expect(select).toBeEnabled();
  await expect(select).toHaveValue(success ? 'family' : 'home');
  await expect(page.locator(moved ? '#openOptions' : '#activeSeerrSite')).toBeFocused();
});

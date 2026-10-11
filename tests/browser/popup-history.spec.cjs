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

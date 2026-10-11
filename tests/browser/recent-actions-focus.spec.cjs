const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

for (const action of ['refresh', 'clear']) for (const success of [true, false]) for (const moved of [false, true]) {
  test(`history ${action} restores focus ownership (success: ${success}, moved: ${moved})`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    const html = fs.readFileSync('src/popup/popup.html', 'utf8')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, '');
    await page.setContent(html);
    await page.addStyleTag({ path: path.resolve('src/popup/popup.css') });
    await page.evaluate(({ action, success }) => {
      const entry = { kind: 'request', mediaType: 'movie', title: 'Example', at: 1 };
      let reads = 0, entries = [entry];
      window.chrome = { runtime: { sendMessage: message => {
        if (message.action === 'clearRecentActions') return new Promise(resolve => {
          window.finishHistoryAction = () => { if (success) entries = []; resolve({ success }); };
        });
        if (message.action === 'getRecentActions') {
          if (++reads > 1 && action === 'refresh') return new Promise(resolve => {
            window.finishHistoryAction = () => resolve({ success, data: entries });
          });
          return Promise.resolve({ success: true, data: entries });
        }
        return Promise.resolve({ success: true, data: entries.map(entry => ({ ...entry, status: 'Available' })) });
      } } };
    }, { action, success });
    await page.addScriptTag({ path: path.resolve('src/popup/recent-actions.js') });
    await expect(page.locator('.recent-action-state')).toHaveText('Available');
    const refresh = page.getByRole('button', { name: 'Refresh statuses' });
    const clear = page.locator('#clearRecentActions');
    const initiating = action === 'refresh' ? refresh : clear;
    await initiating.focus();
    await initiating.press('Enter');
    await expect(initiating).toBeDisabled();
    if (moved) await page.locator('#openOptions').focus();
    await page.evaluate(() => finishHistoryAction());
    const target = moved ? page.locator('#openOptions') : action === 'clear' && success ? refresh : initiating;
    await expect(target).toBeEnabled();
    await expect(target).toBeFocused();
    if (action === 'clear' && success) await expect(page.locator('#recentActionsList li')).toHaveCount(0);
    else await expect(page.locator('#recentActionsList li')).toHaveCount(1);
  });
}

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

for (const success of [false, true]) for (const moved of [false, true]) for (const superseded of [false, true]) {
  test(`site-change history refresh preserves link focus ownership (success: ${success}, moved: ${moved}, superseded: ${superseded})`, async ({ page }) => {
    const html = fs.readFileSync('src/popup/popup.html', 'utf8')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, '');
    await page.setContent(html);
    await page.addStyleTag({ path: path.resolve('src/popup/popup.css') });
    await page.evaluate(() => {
      const entry = { kind: 'request', title: 'Example', mediaType: 'movie', at: 1 };
      let reads = 0, statuses = 0;
      window.historyReads = [];
      window.chrome = { runtime: {
        onMessage: { addListener(listener) { window.notifyHistory = listener; } },
        sendMessage({ action }) {
          if (action === 'getRecentActions') {
            if (++reads > 1) return new Promise(resolve => historyReads.push(success => resolve({ success, data: [entry] })));
            return Promise.resolve({ success: true, data: [entry] });
          }
          const first = ++statuses === 1;
          return Promise.resolve({ success: true, data: [{ ...entry, status: first ? 'Requested' : 'Status unavailable',
            url: first ? 'https://home.example/movie/123' : null }] });
        }
      } };
    });
    await page.addScriptTag({ path: path.resolve('src/popup/recent-actions.js') });
    const list = page.locator('#recentActionsList');
    await expect(list.locator('a')).toHaveCount(1);
    await list.locator('a').focus();
    await page.evaluate(() => notifyHistory({ action: 'seerrConfigChanged' }));
    await page.waitForFunction(() => historyReads.length === 1);
    if (moved) await page.locator('#openOptions').focus();
    if (superseded) {
      await page.evaluate(() => notifyHistory({ action: 'seerrConfigChanged' }));
      await page.waitForFunction(() => historyReads.length === 2);
    }
    await page.evaluate(({ success, superseded }) => historyReads[superseded ? 1 : 0](success), { success, superseded });
    const refresh = page.getByRole('button', { name: 'Refresh statuses' });
    await expect(refresh).toBeEnabled();
    const target = moved ? page.locator('#openOptions') : refresh;
    await expect(target).toBeFocused();
    if (superseded) {
      await page.evaluate(() => historyReads[0](true));
      await expect(target).toBeFocused();
    }
    await expect(list.locator('a')).toHaveCount(0);
    if (success) await expect(list.locator('.recent-action-state')).toHaveText('Status unavailable');
    else await expect(page.locator('#recentActionsStatus')).toContainText('Could not load history');
  });
}

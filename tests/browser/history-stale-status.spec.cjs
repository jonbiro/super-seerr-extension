const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

for (const switched of [false, true]) for (const failure of ['response', 'rejection']) {
  test(`history clears obsolete status while refreshing (site changed: ${switched}, ${failure})`, async ({ page }) => {
    const html = fs.readFileSync('src/popup/popup.html', 'utf8')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, '');
    await page.setContent(html);
    await page.addStyleTag({ path: path.resolve('src/popup/popup.css') });
    await page.evaluate(({ switched, failure }) => {
      const entry = { kind: 'request', mediaType: 'movie', title: 'Example', at: 1, tmdbId: 123, server: 'https://home.example/' };
      let reads = 0, statuses = 0;
      window.chrome = { runtime: {
        onMessage: { addListener(listener) { window.notifyHistory = listener; } },
        sendMessage(message) {
          if (message.action === 'getRecentActions') {
            if (++reads === 2) return new Promise((resolve, reject) => {
              window.finishHistoryRead = () => failure === 'rejection' ? reject(new Error('Worker unavailable')) : resolve({ success: false });
            });
            return Promise.resolve({ success: true, data: [entry] });
          }
          const obsolete = ++statuses === 1;
          return Promise.resolve({ success: true, data: [{ ...entry,
            status: obsolete ? 'Requested' : switched ? 'Status unavailable' : 'Available',
            url: obsolete || !switched ? 'https://home.example/movie/123' : null
          }] });
        }
      } };
    }, { switched, failure });
    await page.addScriptTag({ path: path.resolve('src/popup/recent-actions.js') });
    const list = page.locator('#recentActionsList');
    const status = page.locator('#recentActionsStatus');
    await expect(list.locator('.recent-action-state')).toHaveText('Requested');
    await expect(list.locator('a')).toHaveAttribute('href', 'https://home.example/movie/123');
    if (switched) await page.evaluate(() => notifyHistory({ action: 'seerrConfigChanged' }));
    else await page.getByRole('button', { name: 'Refresh statuses' }).click();
    await expect(list.locator('li')).toHaveCount(1);
    await expect(list).toContainText('Seerr: https://home.example');
    await expect(list.locator('.recent-action-state')).toHaveCount(0);
    await expect(list.locator('a')).toHaveCount(0);
    await expect(status).toHaveText('Loading history…');
    await expect(list).toHaveAttribute('aria-busy', 'true');
    await page.evaluate(() => finishHistoryRead());
    await expect(status).toContainText('Could not load history');
    await expect(list.locator('li')).toHaveCount(1);
    await expect(list.locator('.recent-action-state, a')).toHaveCount(0);
    await expect(list).not.toHaveAttribute('aria-busy', 'true');
    await page.getByRole('button', { name: 'Refresh statuses' }).click();
    await expect(list.locator('.recent-action-state')).toHaveText(switched ? 'Status unavailable' : 'Available');
    await expect(list.locator('a')).toHaveCount(switched ? 0 : 1);
    await expect(status).toHaveText('');
  });
}

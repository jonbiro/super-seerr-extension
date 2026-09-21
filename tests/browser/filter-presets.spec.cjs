const { test, expect } = require('@playwright/test');
const path = require('node:path');

test('long saved preset names and failure messages stay inside a narrow toolbar', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.setContent('<div class="seerr-sort-filter-bar"><select class="seerr-sort-select"><option value="default">Default</option></select></div>');
  await page.addStyleTag({ path: path.resolve('src/content/seerr-overlay.css') });
  await page.addScriptTag({ path: path.resolve('src/content/FilterPresets.js') });
  await page.evaluate(() => {
    window.chrome = { storage: {}, runtime: { sendMessage: async ({ action }) => action === 'getFilterPresets'
      ? { success: true, data: [{ name: 'W'.repeat(40), sort: 'default', filters: {} }] }
      : { success: false, error: 'StorageUnavailable'.repeat(20) } } };
    window.installFilterPresets({ bar: document.querySelector('.seerr-sort-filter-bar'), readCurrent: () => ({ sort: 'default', filters: {} }), apply: () => {} });
  });
  const select = page.getByLabel('Saved filter presets');
  await expect(select).toBeEnabled();
  await select.selectOption('W'.repeat(40));
  await page.getByRole('button', { name: 'Save preset' }).click();
  await expect(page.getByRole('status')).toContainText('StorageUnavailable');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const bounds = await select.boundingBox();
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
});

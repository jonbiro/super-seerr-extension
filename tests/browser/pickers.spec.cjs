const { test, expect } = require('@playwright/test');
const path = require('node:path');

for (const kind of ['title', 'season']) {
  test(`${kind} picker fits a narrow host page without a CSS reset and restores keyboard focus`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.setContent('<button id="opener">Choose</button>');
    await page.addScriptTag({ path: path.resolve('src/shared/NotificationCenter.js') });
    await page.addScriptTag({ path: path.resolve('src/shared/UIComponents.js') });
    await page.addScriptTag({ path: path.resolve('src/shared/SeasonPicker.js') });
    await page.locator('#opener').focus();
    await page.evaluate(kind => {
      const pending = kind === 'title'
        ? new window.UIComponents().chooseTitle([{ title: 'A'.repeat(160), overview: 'A long title description '.repeat(25), mediaType: 'movie', tmdbId: 1 }], { title: 'A'.repeat(160) })
        : window.chooseSeerrSeasons({ title: 'A'.repeat(160), seasons: [{ number: 1, name: 'Season 1', episodeCount: 10, availability: 'Not requested', requestable: true }] });
      pending.then(value => { window.pickerResult = value; });
    }, kind);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(568);
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    if (kind === 'season') {
      const confirm = page.getByRole('button', { name: 'Request selected seasons' });
      await expect(confirm).toBeDisabled();
      await page.getByRole('checkbox').check();
      await expect(confirm).toBeEnabled();
    }
    await page.getByRole('button', { name: 'Cancel', exact: true }).focus();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('#opener')).toBeFocused();
    expect(await page.evaluate(() => window.pickerResult)).toBeNull();
  });
}

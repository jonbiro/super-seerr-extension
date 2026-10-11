const { test, expect } = require('@playwright/test');
const path = require('node:path');

for (const count of [2, 40]) for (const requestable of [true, false]) {
  test(`season review opens at its heading (${count} seasons, requestable: ${requestable})`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 400 });
    await page.setContent('<button id="opener">Choose seasons</button>');
    await page.addScriptTag({ path: path.resolve('src/shared/SeasonPicker.js') });
    await page.locator('#opener').focus();
    await page.evaluate(({ count, requestable }) => {
      window.reviewResult = 'pending';
      chooseSeerrSeasons({ title: 'A series with many seasons', seasons: Array.from({ length: count }, (_, i) => ({
        number: i + 1, name: `Season ${i + 1}`, episodeCount: 8, requestable,
        availability: requestable ? 'Not available' : 'Available'
      })) }).then(result => { window.reviewResult = result; });
    }, { count, requestable });
    const dialog = page.getByRole('dialog', { name: 'Choose TV seasons' });
    const scroll = await dialog.evaluate(node => node.scrollTop);
    if (count === 40 && requestable) await dialog.screenshot({ path: `/tmp/super-seerr-3.5.169-season-${scroll ? 'scrolled' : 'top'}.png` });
    expect(scroll, 'initial focus must not hide the title and first seasons').toBe(0);
    await expect(dialog.getByRole('heading')).toBeFocused();
    expect(await dialog.evaluate(node => {
      const heading = node.querySelector('h2').getBoundingClientRect(), box = node.getBoundingClientRect();
      return heading.top >= box.top && heading.bottom <= box.bottom;
    })).toBe(true);
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: requestable ? 'Select all requestable' : 'Cancel', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('#opener')).toBeFocused();
    expect(await page.evaluate(() => window.reviewResult)).toBe(null);
  });
}

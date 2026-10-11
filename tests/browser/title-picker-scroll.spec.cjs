const { test, expect } = require('@playwright/test');
const path = require('node:path');

for (const count of [0, 1, 20]) test(`title review opens at its explanation (${count} candidates)`, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 400 });
  await page.setContent('<button id="opener">Choose title</button>');
  await page.addScriptTag({ path: path.resolve('src/shared/UIComponents.js') });
  await page.locator('#opener').focus();
  await page.evaluate(count => {
    window.choiceResult = 'pending';
    new UIComponents().chooseTitle(Array.from({ length: count }, (_, i) => ({
      title: `Candidate ${i + 1}`, year: 2000 + i, tmdbId: i + 1, mediaType: 'movie',
      overview: 'A description to distinguish this title from other matches. '.repeat(3)
    })), { title: 'The requested title' }).then(value => { window.choiceResult = value; });
  }, count);
  const dialog = page.getByRole('dialog', { name: 'Choose matching title' });
  const scroll = await dialog.evaluate(node => node.scrollTop);
  if (count === 20) await dialog.screenshot({ path: `/tmp/super-seerr-3.5.170-title-${scroll ? 'scrolled' : 'top'}.png` });
  expect(scroll).toBe(0);
  await expect(dialog.getByRole('heading')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(count ? dialog.locator('.seerr-title-choice').first() : dialog.getByRole('checkbox')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('#opener')).toBeFocused();
  expect(await page.evaluate(() => window.choiceResult)).toBe(null);
});

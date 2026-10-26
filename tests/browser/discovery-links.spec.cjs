const { test, expect } = require('@playwright/test');
const path = require('node:path');

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 400 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setContent('<main></main>');
  await page.addScriptTag({ path: path.resolve('src/shared/UIComponents.js') });
  await page.evaluate(() => {
    window.preferences = {};
    window.chrome = { storage: { sync: { get: async () => preferences, set: async value => Object.assign(preferences, value) } } };
    const ui = new UIComponents({ siteName: 'Explore' });
    ui.injectStyles();
    const { flyout, panel } = ui.createFlyout();
    const controls = ui.createFlyoutContent({ title: 'Amélie & friends', year: 2001, mediaType: 'movie' }, panel);
    ui.updateFlyoutStatus(controls, { status: 'error', message: 'Server offline', buttonText: 'Retry status' });
    document.body.appendChild(flyout);
    flyout.setExpanded(true);
  });
});

test('exploration remains keyboard accessible when Seerr fails and fits a narrow flyout', async ({ page }) => {
  const summary = page.locator('.seerr-title-exploration > summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.seerr-title-exploration')).toHaveAttribute('open', '');
  await page.keyboard.press('Tab');
  const country = page.getByRole('combobox', { name: 'Streaming region' });
  await expect(country).toBeFocused();
  await country.selectOption('de');
  await expect(page.getByRole('link', { name: 'Where to watch' })).toHaveAttribute('href', 'https://www.justwatch.com/de/search?q=Am%C3%A9lie+%26+friends+2001');
  await expect(page.getByRole('link', { name: 'Search Trakt' })).toHaveAttribute('href', 'https://app.trakt.tv/search?q=Am%C3%A9lie+%26+friends+2001');
  await expect(page.getByRole('link', { name: 'Search Simkl' })).toHaveAttribute('href', 'https://simkl.com/search/');
  await expect(page.locator('.seerr-action-button')).toHaveText('Retry status');
  expect(await page.locator('.seerr-panel').evaluate(panel => panel.scrollWidth <= panel.clientWidth)).toBe(true);
  const bounds = await country.boundingBox();
  expect(bounds.width).toBeGreaterThan(100);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open Super Seerr', exact: true })).toBeFocused();
});

test('exploration copy failure has visible feedback and no external navigation', async ({ page }) => {
  await page.locator('.seerr-title-exploration > summary').click();
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('denied'); } } }));
  await page.getByRole('button', { name: 'Copy title', exact: true }).click();
  await expect(page.locator('.seerr-exploration-feedback')).toContainText('Could not copy.');
  await expect(page.getByRole('button', { name: 'Copy title', exact: true })).toBeEnabled();
  await expect(page.getByRole('link', { name: 'Search Simkl' })).toHaveAttribute('rel', 'noopener noreferrer');
  expect(page.context().pages()).toHaveLength(1);
});

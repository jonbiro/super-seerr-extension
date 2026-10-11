const { test, expect } = require('@playwright/test');
const path = require('node:path');

for (const failure of ['response', 'rejection']) test(`Plex detail error stays readable and supports keyboard retry (${failure})`, async ({ page }) => {
  await page.route('https://seerr.example/**', route => route.request().isNavigationRequest()
    ? route.fulfill({ contentType: 'text/html', body: '<header class="media-header"><h1>Dune (2021)</h1></header>' })
    : route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.goto('https://seerr.example/movie/123');
  await page.evaluate(failure => {
    window.writes = [];
    window.chrome = { storage: { sync: { get: async () => ({ seerrUrl: 'https://seerr.example' }) }, onChanged: { addListener() {} } },
      runtime: { onMessage: { addListener() {} }, sendMessage: async message => {
        if (message.action === 'getConfigState') return { success: true, data: { serverUrl: 'https://seerr.example', plexConfigured: true } };
        if (message.action === 'plexWatchlistState') return new Promise(resolve => { window.finishState = resolve; });
        if (message.action === 'plexAddToWatchlist') {
          window.writes.push(message);
          if (window.writes.length > 1) return { success: true, data: {} };
          if (failure === 'rejection') throw new Error('Connection interrupted <img src=x>');
          return { success: false, error: 'Permission denied <img src=x>' };
        }
        return { success: true, data: {} };
      } } };
  }, failure);
  await page.addStyleTag({ path: path.resolve('src/content/seerr-overlay.css') });
  for (const file of ['shared/RatingsConfig', 'shared/RatingsModel', 'shared/NotificationCenter', 'shared/SeasonPicker',
    'content/OverlayCache', 'content/RatingsPresentation', 'content/SeerrSession', 'content/FilterPresets', 'content/RatingQueue', 'content/seerr-integration']) {
    await page.addScriptTag({ path: path.resolve(`src/${file}.js`) });
  }
  const add = page.getByRole('button', { name: '＋ Add to Plex Watchlist', exact: true });
  await expect(add).toBeVisible();
  await page.clock.install();
  await add.focus(); await page.keyboard.press('Enter');
  await page.clock.runFor(10);
  const note = page.getByRole('alert');
  await expect(note).toContainText(failure === 'rejection' ? 'Connection interrupted' : 'Permission denied');
  await expect(note).toContainText('<img src=x>');
  await expect(note.locator('img')).toHaveCount(0);
  await expect(add).toBeEnabled();
  await page.evaluate(() => window.finishState({ success: true, data: { onWatchlist: true } }));
  await expect(add).toBeEnabled();
  await page.clock.fastForward(6000);
  await expect(note).toBeVisible();
  await note.getByRole('button', { name: 'Dismiss notification' }).focus();
  await page.keyboard.press('Enter'); await page.clock.runFor(350);
  await expect(note).toHaveCount(0);
  await expect(add).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '✓ Added to Plex Watchlist', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.writes.length)).toBe(2);
});

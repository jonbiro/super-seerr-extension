const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

async function showTrackers(page, width, { failInitial = false } = {}) {
  await page.setViewportSize({ width, height: 740 });
  const html = fs.readFileSync('src/options/options.html', 'utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, '');
  await page.setContent(html);
  await page.addStyleTag({ path: path.resolve('src/options/options.css') });
  await page.addStyleTag({ path: path.resolve('src/options/tracker-accounts.css') });
  await page.evaluate(fail => {
    window.accountEntries = ['trakt', 'simkl'].map(provider => ({ provider, name: provider, clientId: `${provider}-app`, connected: true,
      callbackUrl: `https://${'extension'.repeat(5)}.chromiumapp.org/tracker/${provider}`, lastSyncAt: null }));
    window.trackerMessages = [];
    window.trackerTabs = [];
    window.failTrackerInitial = fail;
    window.chrome = {
      permissions: { request: async () => true },
      tabs: { create: async options => trackerTabs.push(options) },
      runtime: { sendMessage: async message => {
        trackerMessages.push(message);
        if (message.action === 'getTrackerAccounts' && failTrackerInitial) {
          failTrackerInitial = false;
          return { success: false, error: 'Connection state could not be read. Try again.' };
        }
        if (message.action === 'disconnectTracker') accountEntries.find(account => account.provider === message.data.provider).connected = false;
        if (message.action === 'getTrackerWatchlist') return { success: true, data: { provider: message.data.provider, page: 1,
          items: [{ title: 'A very long movie title with Unicode 日本語 and characters & / for narrow screen review'.repeat(2), mediaType: 'movie', year: 1999 },
            { title: 'An example series', mediaType: 'tv', year: 2020 }], nextPage: null, hasMore: false, skipped: 1, truncated: true, lastSyncAt: Date.now() } };
        if (message.action === 'getConfigState') return { success: true, data: { serverUrl: 'https://family.example/seerr/' } };
        return { success: true, data: structuredClone(accountEntries) };
      } }
    };
  }, failInitial);
  await page.addScriptTag({ path: path.resolve('src/options/tracker-accounts.js') });
  await expect(page.locator('#trackerAccountsHeading')).toHaveText('Trakt & Simkl watchlists');
}

for (const width of [320, 390, 768, 1440]) test(`tracker account setup and watchlist review fit ${width}px`, async ({ page }) => {
  await showTrackers(page, width);
  const card = page.locator('[data-tracker="trakt"]');
  await expect(card.getByRole('button', { name: 'Sync watchlist', exact: true })).toBeEnabled();
  await expect(card.getByLabel('Callback URL for this browser')).toHaveAttribute('readonly', '');
  await card.getByRole('button', { name: 'Sync watchlist', exact: true }).click();
  await expect(card.getByRole('list', { name: 'Trakt watchlist titles' }).getByRole('listitem')).toHaveCount(2);
  await expect(card.locator('.tracker-account-status')).toContainText('limited to 500');
  if (process.env.TRACKER_PREVIEW) {
    await expect(page).toHaveTitle('Super Seerr - Settings');
    await page.locator('#trackerAccounts').screenshot({ path: `/tmp/super-seerr-tracker-settings-${process.env.TRACKER_PREVIEW}-${width}.png` });
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const bounds = await card.boundingBox();
  for (const control of await card.locator('input,textarea,button').all()) {
    if (!await control.isVisible()) continue;
    const box = await control.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(bounds.x);
    expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
  }
  const find = card.getByRole('button', { name: 'Find An example series in Seerr', exact: true });
  await find.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => trackerTabs.length)).toBe(1);
  expect(await page.evaluate(() => trackerTabs[0].url)).toBe('https://family.example/seerr/search?query=An+example+series');
  await card.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(card.locator('.tracker-account-summary')).toHaveText('Not connected.');
  await expect(card.getByRole('list', { name: 'Trakt watchlist titles' }).getByRole('listitem')).toHaveCount(0);
  expect(await page.evaluate(() => trackerMessages.some(message => message.action === 'requestMedia'))).toBe(false);
});

test('tracker account startup failure stays recoverable and keyboard accessible', async ({ page }) => {
  await showTrackers(page, 320, { failInitial: true });
  await expect(page.locator('.tracker-section-status')).toContainText('Connection state could not be read');
  const card = page.locator('[data-tracker="simkl"]');
  await expect(card.getByRole('button', { name: 'Connect Simkl', exact: true })).toBeDisabled();
  const retry = page.getByRole('button', { name: 'Reload account connections', exact: true });
  await retry.focus(); await page.keyboard.press('Enter');
  await expect(card.getByRole('button', { name: 'Sync watchlist', exact: true })).toBeEnabled();
  await expect(page.locator('.tracker-section-status')).toHaveText('');
});

const { test, expect } = require('@playwright/test');
const path = require('node:path');

test.beforeEach(async ({ page }) => {
  await page.route('https://seerr.example/**', route => route.request().isNavigationRequest()
    ? route.fulfill({ contentType: 'text/html', body: `<main><button id="outside">Other action</button><article data-testid="title-card"><a href="/tv/920"><h2>Series</h2></a></article></main>
      <script type="application/json">{"props":{"results":[{"id":920,"mediaType":"tv","name":"Series","rtCriticsScore":80,"rtAudienceScore":90,"imdbRating":8,"voteAverage":8}]}}</script>` })
    : route.fulfill({ contentType: 'application/json', body: '{"results":[]}' }));
  await page.goto('https://seerr.example/discover');
  await page.evaluate(() => {
    window.writes = [];
    window.chrome = { storage: { sync: { get: async () => ({ seerrUrl: 'https://seerr.example' }) }, onChanged: { addListener() {}, removeListener() {} } },
      runtime: { onMessage: { addListener() {} }, sendMessage: async message => {
        if (message.action === 'getConfigState') return { success: true, data: { serverUrl: 'https://seerr.example', apiConfigured: true, connectionToken: 'fixture' } };
        if (message.action === 'getFilterPresets') return { success: true, data: [] };
        if (message.action === 'getSeasonOptions') {
          if (window.deferSeasons) return new Promise(resolve => { window.finishSeasons = resolve; });
          return { success: true, data: { title: 'Series', tmdbId: 920, server: 'https://seerr.example', seasons: [
            { number: 1, name: 'Season 1', episodeCount: 8, availability: 'Not available', requestable: true }
          ] } };
        }
        if (message.action === 'requestMedia') window.writes.push(message);
        return { success: true, data: {} };
      } } };
  });
  for (const file of ['shared/RatingsConfig', 'shared/RatingsModel', 'shared/NotificationCenter', 'shared/SeasonPicker',
    'content/OverlayCache', 'content/RatingsPresentation', 'content/SeerrSession', 'content/FilterPresets', 'content/RatingQueue', 'content/seerr-integration']) {
    await page.addScriptTag({ path: path.resolve(`src/${file}.js`) });
  }
  await page.getByRole('button', { name: 'Select titles', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Select Series', exact: true }).check();
  await page.locator('.seerr-bulk-review').click();
  await expect(page.getByRole('dialog', { name: 'Review your bulk request' })).toBeVisible();
});

for (const outcome of ['cancel', 'confirm', 'error', 'moved']) test(`bulk TV season review preserves focus and sends no request (${outcome})`, async ({ page }) => {
  const bulk = page.getByRole('dialog', { name: 'Review your bulk request' });
  const choose = bulk.getByRole('button', { name: 'Choose seasons' });
  if (outcome === 'error' || outcome === 'moved') await page.evaluate(() => { window.deferSeasons = true; });
  await choose.focus();
  await page.keyboard.press('Enter');
  if (outcome === 'error' || outcome === 'moved') {
    await expect(choose).toBeDisabled();
    if (outcome === 'moved') await page.locator('#outside').focus();
    await page.evaluate(() => window.finishSeasons({ success: false, error: 'Availability unavailable' }));
  } else {
    const picker = page.getByRole('dialog', { name: 'Choose TV seasons' });
    await expect(picker).toBeVisible();
    if (outcome === 'cancel') await page.keyboard.press('Escape');
    else {
      await picker.getByRole('checkbox').check();
      await picker.getByRole('button', { name: 'Use selected seasons' }).focus();
      await page.keyboard.press('Enter');
    }
    await expect(picker).toHaveCount(0);
  }
  await expect(choose).toBeEnabled();
  await expect(outcome === 'moved' ? page.locator('#outside') : choose).toBeFocused();
  expect(await page.evaluate(() => window.writes)).toEqual([]);
});

test('bulk review keeps host shortcuts from cancelling keyboard navigation', async ({ page }) => {
  await page.evaluate(() => {
    window.hostKeys = [];
    document.addEventListener('keydown', event => { window.hostKeys.push(event.key); event.preventDefault(); });
  });
  const bulk = page.getByRole('dialog', { name: 'Review your bulk request' });
  await bulk.getByRole('button', { name: 'Choose seasons' }).focus();
  await page.keyboard.press('Tab');
  await expect(bulk.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(bulk).toHaveCount(0);
  expect(await page.evaluate(() => window.hostKeys)).toEqual([]);
  await page.keyboard.press('h');
  expect(await page.evaluate(() => window.hostKeys)).toEqual(['h']);
  expect(await page.evaluate(() => window.writes)).toEqual([]);
});

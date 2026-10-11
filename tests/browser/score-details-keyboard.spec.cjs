const { test, expect } = require('@playwright/test');
const path = require('node:path');

test.beforeEach(async ({ page }) => {
  await page.route('https://seerr.example/**', route => route.request().isNavigationRequest()
    ? route.fulfill({ contentType: 'text/html', body: `<main><button id="outside">Other action</button><article data-testid="title-card"><a href="/movie/920"><h2>Example</h2></a></article></main>
      <script type="application/json">{"props":{"results":[{"id":920,"mediaType":"movie","title":"Example","rtCriticsScore":80,"rtAudienceScore":90,"imdbRating":8,"voteAverage":8}]}}</script>` })
    : route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.goto('https://seerr.example/discover');
  await page.evaluate(() => {
    window.chrome = { storage: { sync: { get: async () => ({ seerrUrl: 'https://seerr.example' }) }, onChanged: { addListener() {}, removeListener() {} } },
      runtime: { onMessage: { addListener() {} }, sendMessage: async message => {
        if (message.action === 'getConfigState') return { success: true, data: { serverUrl: 'https://seerr.example', apiConfigured: true } };
        if (message.action === 'getFilterPresets') return { success: true, data: [] };
        if (message.action === 'getRottenTomatoesRatings') return new Promise(resolve => { window.finishRatings = resolve; });
        return { success: true, data: {} };
      } } };
  });
  for (const file of ['shared/RatingsConfig', 'shared/RatingsModel', 'shared/NotificationCenter', 'shared/SeasonPicker',
    'content/OverlayCache', 'content/RatingsPresentation', 'content/SeerrSession', 'content/FilterPresets', 'content/RatingQueue', 'content/seerr-integration']) {
    await page.addScriptTag({ path: path.resolve(`src/${file}.js`) });
  }
  await expect(page.locator('.seerr-rating-details')).toHaveCount(1);
});

test('score details isolate keyboard navigation from host shortcuts', async ({ page }) => {
  await page.evaluate(() => {
    window.hostKeys = [];
    document.addEventListener('keydown', event => { window.hostKeys.push(event.key); event.preventDefault(); });
  });
  const details = page.locator('.seerr-rating-details');
  await details.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(details).toHaveAttribute('open', '');
  await page.keyboard.press('Tab');
  await expect(details.getByRole('button', { name: 'Retry scores' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(details.locator('summary')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(details).not.toHaveAttribute('open', '');
  expect(await page.evaluate(() => window.hostKeys)).toEqual([]);
  await page.locator('#outside').focus();
  await page.keyboard.press('h');
  expect(await page.evaluate(() => window.hostKeys)).toEqual(['h']);
});

for (const outcome of ['success', 'failure']) for (const moved of [false, true]) test(`retry scores preserves keyboard focus ownership (${outcome}, moved: ${moved})`, async ({ page }) => {
  const details = page.locator('.seerr-rating-details');
  await details.locator('summary').click();
  const retry = details.locator('button');
  await retry.focus();
  await page.keyboard.press('Enter');
  await expect(retry).toHaveText('Checking…');
  await expect.poll(() => page.evaluate(() => typeof window.finishRatings)).toBe('function');
  if (moved) await page.locator('#outside').focus();
  await page.evaluate(outcome => window.finishRatings(outcome === 'success'
    ? { success: true, data: { rtCriticsScore: 95, rtAudienceScore: 90, confidence: 1 } }
    : { success: false, error: 'Provider unavailable' }), outcome);
  await expect(details.locator('button')).toHaveText('Retry scores');
  await expect(page.locator('.seerr-card-badge').first()).toContainText(outcome === 'success' ? '95%' : '80%');
  await expect(details).toHaveAttribute('open', '');
  await expect(moved ? page.locator('#outside') : details.getByRole('button', { name: 'Retry scores' })).toBeFocused();
});

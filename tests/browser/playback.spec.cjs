const { test, expect } = require('@playwright/test');
const path = require('node:path');

test('playback opens the media URL without an opener and rejects relative or executable destinations', async ({ page, context }) => {
  await context.route('https://discovery.example/**', route => route.fulfill({ contentType: 'text/html', body: '<button id="watch">Watch</button>' }));
  await context.route('https://media.example/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Playback</h1>' }));
  await page.goto('https://discovery.example/title/550');
  for (const name of ['SeerrClient', 'MediaExtractor', 'UIComponents', 'BaseIntegration']) {
    await page.addScriptTag({ path: path.resolve(`src/shared/${name}.js`) });
  }
  await page.evaluate(() => {
    window.integration = new window.BaseIntegration('Playback probe');
    integration.mediaData = { title: 'Example', mediaType: 'movie', tmdbId: 550 };
    integration.ui.createNotification = () => {};
    integration.updateUIFromStatus = () => {};
    window.destination = 'https://media.example/web/index.html#!/details?id=550';
    document.getElementById('watch').onclick = () => integration.openMediaServer(destination);
  });
  const opening = page.waitForEvent('popup');
  await page.locator('#watch').click();
  const popup = await opening;
  await expect(popup).toHaveURL('https://media.example/web/index.html#!/details?id=550');
  expect(await popup.evaluate(() => window.opener === null)).toBe(true);
  await popup.close();
  for (const destination of ['/watch/550', 'javascript:alert(1)', 'https://user:secret@media.example/watch/550']) {
    await page.evaluate(value => { window.destination = value; }, destination);
    await page.locator('#watch').click();
    expect(context.pages()).toHaveLength(1);
    expect(await page.evaluate(() => integration.currentStatusData.action)).toBe('retryStatus');
    await expect(page).toHaveURL('https://discovery.example/title/550');
  }
});

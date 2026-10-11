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

test('bulk review starts at its heading on a short screen', async ({ page }) => {
  await page.addStyleTag({ path: path.resolve('src/content/seerr-overlay.css') });
  await page.getByRole('dialog', { name: 'Review your bulk request' }).getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.setViewportSize({ width: 320, height: 220 });
  await page.evaluate(() => {
    for (let i = 1; i <= 20; i++) {
      const card = document.createElement('article');
      card.dataset.testid = 'title-card';
      const link = document.createElement('a'); link.href = `/movie/${1000 + i}`;
      const heading = document.createElement('h2'); heading.textContent = `Movie ${i}`;
      link.append(heading); card.append(link); document.querySelector('main').append(card);
    }
  });
  await expect(page.locator('.seerr-select-checkbox')).toHaveCount(21);
  await page.locator('.seerr-select-checkbox').evaluateAll(nodes => nodes.forEach(node => {
    if (node.getAttribute('aria-checked') !== 'true') node.click();
  }));
  const review = page.locator('.seerr-bulk-review');
  await review.click();
  const dialog = page.getByRole('dialog', { name: 'Review your bulk request' });
  const scroll = await dialog.evaluate(node => node.scrollTop);
  await dialog.screenshot({ path: `/tmp/super-seerr-3.5.170-bulk-${scroll ? 'scrolled' : 'top'}.png` });
  expect(scroll).toBe(0);
  await expect(dialog.getByRole('heading')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Choose seasons' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(review).toBeFocused();
  expect(await page.evaluate(() => window.writes)).toEqual([]);
});

test('bulk review uses a singular title count for one selected title', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Review your bulk request' });
  await expect(dialog).toContainText('1 title ready to request');
  await expect(dialog.getByRole('button', { name: 'Request 1 title', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.writes)).toEqual([]);
});

for (const success of [true, false]) for (const focus of ['dialog', 'outside', 'removed']) {
  test(`bulk completion preserves focus ownership (${success ? 'success' : 'failure'}, ${focus})`, async ({ page }) => {
    const dialog = page.getByRole('dialog', { name: 'Review your bulk request' });
    await dialog.getByRole('button', { name: 'Choose seasons' }).click();
    const picker = page.getByRole('dialog', { name: 'Choose TV seasons' });
    await picker.getByRole('checkbox').check();
    await picker.getByRole('button', { name: 'Use selected seasons' }).click();
    await page.evaluate(() => {
      const original = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = message => {
        if (message.action !== 'requestMedia') return original(message);
        window.writes.push(message);
        return new Promise(resolve => { window.finishRequest = resolve; });
      };
    });
    await dialog.getByRole('button', { name: 'Request 1 title', exact: true }).click();
    await page.waitForFunction(() => typeof window.finishRequest === 'function');
    if (focus === 'outside') await page.locator('#outside').focus();
    if (focus === 'removed') await page.locator('.seerr-select-checkbox').focus();
    await page.evaluate(success => window.finishRequest({ success, error: success ? undefined : 'Request rejected' }), success);
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Select titles', exact: true })).toBeVisible();
    await expect(focus === 'outside' ? page.locator('#outside') : page.getByRole('button', { name: 'Select titles', exact: true })).toBeFocused();
    expect(await page.evaluate(() => window.writes.length)).toBe(1);
    // The completion notification must remember the surviving focus target,
    // rather than the review button or card control removed by cleanup.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const dismiss = page.getByRole('button', { name: 'Dismiss notification', exact: true });
    await dismiss.focus();
    await page.keyboard.press('Enter');
    await expect(dismiss).toHaveCount(0);
    await expect(focus === 'outside' ? page.locator('#outside') : page.getByRole('button', { name: 'Select titles', exact: true })).toBeFocused();
  });
}

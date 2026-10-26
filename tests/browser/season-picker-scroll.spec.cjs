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

for (const width of [320, 768]) test(`season review identifies Seerr and keeps its title link in the focus loop (${width}px)`, async ({ page }) => {
  await page.setViewportSize({ width, height: 400 });
  await page.setContent('<button id="opener">Choose seasons</button>');
  for (const file of ['MediaValidation', 'SeasonPicker']) await page.addScriptTag({ path: path.resolve(`src/shared/${file}.js`) });
  await page.locator('#opener').focus();
  await page.evaluate(() => { chooseSeerrSeasons({ title: 'Example series', server: 'https://seerr.example/family///', tmdbId: 42,
    seasons: [{ number: 0, name: 'Specials', episodeCount: 8, requestable: false, availability: 'Specials disabled in Seerr' },
      { number: 1, name: 'Season 1', episodeCount: 8, requestable: false, availability: 'Request failed — review in Seerr' }] }); });
  const dialog = page.getByRole('dialog', { name: 'Choose TV seasons' });
  await expect(dialog).toContainText('Seerr: seerr.example/family');
  await expect(dialog.getByRole('heading')).toBeFocused();
  expect(await dialog.evaluate(node => node.scrollTop)).toBe(0);
  await page.screenshot({ path: `/tmp/super-seerr-request-review-${width}.png` });
  const link = dialog.getByRole('link', { name: 'Open this title in Seerr' });
  await expect(link).toHaveAttribute('href', 'https://seerr.example/family/tv/42');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await page.keyboard.press('Tab');
  await expect(link).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(link).toBeFocused();
  const box = await dialog.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  await page.keyboard.press('Escape');
  await expect(page.locator('#opener')).toBeFocused();
});

test('season review does not link to malformed Seerr URLs', async ({ page }) => {
  await page.setContent('<main>Fixture</main>');
  for (const file of ['MediaValidation', 'SeasonPicker']) await page.addScriptTag({ path: path.resolve(`src/shared/${file}.js`) });
  for (const server of ['javascript:alert(1)', 'https://user:password@seerr.example', 'https://seerr.example?key=secret']) {
    await page.evaluate(server => { chooseSeerrSeasons({ title: 'Example series', server, tmdbId: 42, seasons: [] }); }, server);
    await expect(page.getByRole('dialog').getByRole('link')).toHaveCount(0);
    await page.keyboard.press('Escape');
  }
});

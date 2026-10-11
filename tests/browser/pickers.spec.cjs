const { test, expect } = require('@playwright/test');
const path = require('node:path');

for (const kind of ['title', 'season']) {
  test(`${kind} picker fits a narrow host page without a CSS reset and restores keyboard focus`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.setContent('<button id="opener">Choose</button>');
    await page.addScriptTag({ path: path.resolve('src/shared/NotificationCenter.js') });
    await page.addScriptTag({ path: path.resolve('src/shared/UIComponents.js') });
    await page.addScriptTag({ path: path.resolve('src/shared/SeasonPicker.js') });
    await page.locator('#opener').focus();
    await page.evaluate(kind => {
      const pending = kind === 'title'
        ? new window.UIComponents().chooseTitle([{ title: 'A'.repeat(160), overview: 'A long title description '.repeat(25), mediaType: 'movie', tmdbId: 1 }], { title: 'A'.repeat(160) })
        : window.chooseSeerrSeasons({ title: 'A'.repeat(160), seasons: [{ number: 1, name: 'Season 1', episodeCount: 10, availability: 'Not requested', requestable: true }] });
      pending.then(value => { window.pickerResult = value; });
    }, kind);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(568);
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    if (kind === 'season') {
      const confirm = page.getByRole('button', { name: 'Request selected seasons' });
      await expect(confirm).toBeDisabled();
      await page.getByRole('checkbox').check();
      await expect(confirm).toBeEnabled();
    }
    await page.getByRole('button', { name: 'Cancel', exact: true }).focus();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('#opener')).toBeFocused();
    expect(await page.evaluate(() => window.pickerResult)).toBeNull();
  });
}

test('season bulk selection counts only requestable seasons and preserves keyboard focus', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.setContent('<button id="opener">Choose</button>');
  await page.addScriptTag({ path: path.resolve('src/shared/SeasonPicker.js') });
  await page.locator('#opener').focus();
  await page.evaluate(() => {
    window.chooseSeerrSeasons({ title: 'Example series', seasons: [
      { number: 1, name: 'Season 1', episodeCount: 8, availability: 'Available', requestable: false },
      { number: 2, name: 'Season 2', episodeCount: 8, availability: 'Not available', requestable: true },
      { number: 3, name: 'Season 3', episodeCount: 8, availability: 'Not available', requestable: true }
    ] }).then(value => { window.pickerResult = value; });
  });
  const dialog = page.getByRole('dialog');
  const all = dialog.getByRole('button', { name: 'Select all requestable' });
  const clear = dialog.getByRole('button', { name: 'Clear selection' });
  const confirm = dialog.getByRole('button', { name: 'Request selected seasons' });
  await expect(dialog.getByRole('status')).toHaveText('0 seasons selected');
  await all.focus(); await page.keyboard.press('Enter');
  await expect(dialog.getByRole('status')).toHaveText('2 seasons selected');
  await expect(all).toBeDisabled(); await expect(clear).toBeFocused();
  await expect(dialog.getByRole('checkbox').nth(0)).not.toBeChecked();
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('status')).toHaveText('0 seasons selected');
  await expect(all).toBeFocused(); await expect(confirm).toBeDisabled();
  await dialog.getByRole('checkbox').nth(1).check();
  await expect(dialog.getByRole('status')).toHaveText('1 season selected');
  await all.click();
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await confirm.click();
  expect(await page.evaluate(() => window.pickerResult)).toEqual([2, 3]);
  await expect(page.locator('#opener')).toBeFocused();
});

test('season selection controls stay disabled when every season is unavailable to request', async ({ page }) => {
  await page.setContent('<main></main>');
  await page.addScriptTag({ path: path.resolve('src/shared/SeasonPicker.js') });
  await page.evaluate(() => {
    window.chooseSeerrSeasons({ title: 'Available series', seasons: [
      { number: 1, name: 'Season 1', episodeCount: 8, availability: 'Available', requestable: false }
    ] });
  });
  for (const name of ['Select all requestable', 'Clear selection', 'Request selected seasons']) {
    await expect(page.getByRole('button', { name })).toBeDisabled();
  }
  await expect(page.getByRole('heading', { name: 'Available series' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

for (const cancel of ['button', 'Escape']) test(`TV request restores its initiating button after season cancellation (${cancel})`, async ({ page }) => {
  await page.setContent('<button id="opener"><span>Request</span></button>');
  for (const file of ['UIComponents', 'SeasonPicker', 'BaseIntegration']) {
    await page.addScriptTag({ path: path.resolve(`src/shared/${file}.js`) });
  }
  await page.locator('#opener').focus();
  await page.evaluate(() => {
    const integration = Object.create(window.BaseIntegration.prototype);
    Object.assign(integration, {
      mediaData: { title: 'Example Series', mediaType: 'tv', tmdbId: 1 },
      uiElements: { button: document.getElementById('opener') }, ui: new window.UIComponents(),
      currentStatusData: { status: 'available', buttonClass: 'request', buttonText: 'Request', disabled: false },
      client: { sendMessage: async () => ({ success: true, data: { title: 'Example Series', seasons: [
        { number: 1, name: 'Season 1', episodeCount: 10, availability: 'Not requested', requestable: true }
      ] } }), requestMedia: async () => { window.requestsSent++; } },
      error() {}, log() {}
    });
    window.requestsSent = 0;
    void integration.handleRequestButtonClick().then(() => { window.requestFlowFinished = true; });
  });
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('#opener')).toBeDisabled();
  if (cancel === 'button') await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  else await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#opener')).toBeEnabled();
  await expect(page.locator('#opener')).toBeFocused();
  expect(await page.evaluate(() => requestsSent)).toBe(0);
});

for (const kind of ['title', 'season']) test(`${kind} picker cleanup preserves focus moved outside it`, async ({ page }) => {
  await page.setContent('<button id="opener">Choose</button><button id="destination">New page action</button>');
  await page.addScriptTag({ path: path.resolve('src/shared/UIComponents.js') });
  await page.addScriptTag({ path: path.resolve('src/shared/SeasonPicker.js') });
  await page.locator('#opener').focus();
  await page.evaluate(kind => {
    window.pickerController = new AbortController();
    const settings = { signal: window.pickerController.signal };
    const pending = kind === 'title'
      ? new window.UIComponents().chooseTitle([{ title: 'Film', mediaType: 'movie', tmdbId: 1 }], settings)
      : window.chooseSeerrSeasons({ title: 'Series', seasons: [] }, settings);
    pending.then(value => { window.pickerResult = value; });
  }, kind);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('#destination').focus();
  await page.evaluate(() => window.pickerController.abort());
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#destination')).toBeFocused();
  expect(await page.evaluate(() => window.pickerResult)).toBeNull();
});

for (const kind of ['title', 'season']) test(`${kind} picker keeps host shortcuts from cancelling keyboard selection`, async ({ page }) => {
  await page.setContent('<button id="opener">Choose</button>');
  await page.addScriptTag({ path: path.resolve('src/shared/UIComponents.js') });
  await page.addScriptTag({ path: path.resolve('src/shared/SeasonPicker.js') });
  await page.locator('#opener').focus();
  await page.evaluate(kind => {
    window.hostKeys = [];
    document.addEventListener('keydown', event => { window.hostKeys.push(event.key); event.preventDefault(); });
    const pending = kind === 'title'
      ? new window.UIComponents().chooseTitle([{ title: 'Film', mediaType: 'movie', tmdbId: 1 }])
      : window.chooseSeerrSeasons({ title: 'Series', seasons: [{ number: 1, name: 'Season 1', episodeCount: 8, availability: 'Not available', requestable: true }] });
    pending.then(value => { window.pickerResult = value; });
  }, kind);
  const dialog = page.getByRole('dialog');
  const checkbox = dialog.getByRole('checkbox');
  if (kind === 'title') {
    await dialog.locator('.seerr-title-choice').focus();
    await page.keyboard.press('Tab');
    await expect(checkbox).toBeFocused();
  } else await checkbox.focus();
  await page.keyboard.press('Space');
  await expect(checkbox).toBeChecked();
  if (kind === 'title') {
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.locator('.seerr-title-choice')).toBeFocused();
  } else {
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Request selected seasons' })).toBeFocused();
  }
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => window.hostKeys)).toEqual([]);
  const result = await page.evaluate(() => window.pickerResult);
  if (kind === 'title') expect(result).toMatchObject({ tmdbId: 1, rememberChoice: true });
  else expect(result).toEqual([1]);
  await page.keyboard.press('h');
  expect(await page.evaluate(() => window.hostKeys)).toEqual(['h']);
});

test('season picker distinguishes unavailable episode counts and uses singular wording', async ({ page }) => {
  await page.setContent('<button id="opener">Choose</button>');
  await page.addScriptTag({ path: path.resolve('src/shared/SeasonPicker.js') });
  await page.evaluate(() => {
    chooseSeerrSeasons({ title: 'Example series', seasons: [
      { number: 1, name: 'Season 1', episodeCount: 0, availability: 'Season information uncertain', requestable: false },
      { number: 2, name: 'Season 2', availability: 'Status unknown', requestable: false },
      { number: 3, name: 'Season 3', episodeCount: 1, availability: 'Not available', requestable: true },
      { number: 4, name: 'Season 4', episodeCount: 8, availability: 'Not available', requestable: true }
    ] }).then(value => { window.pickerResult = value; });
  });
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('checkbox', { name: 'Season 1 (Episode count unavailable) — Season information uncertain', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('checkbox', { name: 'Season 2 (Episode count unavailable) — Status unknown', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('checkbox', { name: 'Season 3 (1 episode) — Not available', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('checkbox', { name: 'Season 4 (8 episodes) — Not available', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Select all requestable' }).click();
  await dialog.getByRole('button', { name: 'Request selected seasons' }).click();
  expect(await page.evaluate(() => window.pickerResult)).toEqual([3, 4]);
});

const { test, expect } = require('@playwright/test');
const path = require('node:path');

test('long saved preset names and failure messages stay inside a narrow toolbar', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.setContent('<div class="seerr-sort-filter-bar"><select class="seerr-sort-select"><option value="default">Default</option></select></div>');
  await page.addStyleTag({ path: path.resolve('src/content/seerr-overlay.css') });
  await page.addScriptTag({ path: path.resolve('src/content/FilterPresets.js') });
  await page.evaluate(() => {
    window.chrome = { storage: {}, runtime: { sendMessage: async ({ action }) => action === 'getFilterPresets'
      ? { success: true, data: [{ name: 'W'.repeat(40), sort: 'default', filters: {} }] }
      : { success: false, error: 'StorageUnavailable'.repeat(20) } } };
    window.installFilterPresets({ bar: document.querySelector('.seerr-sort-filter-bar'), readCurrent: () => ({ sort: 'default', filters: {} }), apply: () => {} });
  });
  const select = page.getByLabel('Saved filter presets');
  await expect(select).toBeEnabled();
  await select.selectOption('W'.repeat(40));
  await page.getByRole('button', { name: 'Save preset' }).click();
  await expect(page.getByRole('status')).toContainText('StorageUnavailable');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const bounds = await select.boundingBox();
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
});

async function installPresets(page) {
  await page.setContent('<button id="outside">Other action</button><div class="seerr-sort-filter-bar"><select class="seerr-sort-select"><option value="default">Default</option></select></div>');
  await page.addScriptTag({ path: path.resolve('src/content/FilterPresets.js') });
  await page.evaluate(() => {
    window.chrome = { storage: {}, runtime: { sendMessage: async ({ action }) => {
      if (action === 'getFilterPresets') return { success: true, data: [{ name: 'Night', sort: 'default', filters: {} }] };
      return new Promise(resolve => { window.finishPreset = resolve; });
    } } };
    window.installFilterPresets({ bar: document.querySelector('.seerr-sort-filter-bar'), readCurrent: () => ({ sort: 'default', filters: {} }), apply: () => {} });
  });
  await expect(page.getByLabel('Saved filter presets')).toBeEnabled();
  await page.getByLabel('Saved filter presets').selectOption('Night');
}

for (const action of ['Save', 'Delete']) for (const outcome of ['success', 'failure']) for (const moved of [false, true]) {
  test(`${action} preset preserves keyboard focus ownership (${outcome}, moved: ${moved})`, async ({ page }) => {
    await installPresets(page);
    const button = page.getByRole('button', { name: `${action} preset`, exact: true });
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(button).toBeDisabled();
    if (moved) await page.locator('#outside').focus();
    await page.evaluate(({ action, outcome }) => window.finishPreset(outcome === 'failure'
      ? { success: false, error: 'Storage unavailable' }
      : { success: true, data: action === 'Delete' ? [] : [{ name: 'Night', sort: 'default', filters: {} }] }), { action, outcome });
    await expect(page.getByLabel('Saved filter presets')).toBeEnabled();
    const target = moved ? page.locator('#outside') : action === 'Delete' && outcome === 'success'
      ? page.getByLabel('Saved filter presets') : button;
    await expect(target).toBeFocused();
    if (action === 'Delete' && outcome === 'success') await expect(button).toBeDisabled();
    else await expect(button).toBeEnabled();
  });
}

test('preset controls keep host shortcuts from blocking typing and Tab navigation', async ({ page }) => {
  await installPresets(page);
  await page.evaluate(() => {
    window.hostKeys = [];
    document.addEventListener('keydown', event => { window.hostKeys.push(event.key); event.preventDefault(); });
  });
  const name = page.getByLabel('Preset name');
  await name.fill(''); await name.focus();
  await page.keyboard.press('a');
  await expect(name).toHaveValue('a');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Save preset' })).toBeFocused();
  expect(await page.evaluate(() => window.hostKeys)).toEqual([]);
  await page.locator('#outside').focus();
  await page.keyboard.press('h');
  expect(await page.evaluate(() => window.hostKeys)).toEqual(['h']);
});

for (const inForm of [false, true]) for (const success of [true, false]) test(`Enter saves the named preset without submitting the host page (form: ${inForm}, success: ${success})`, async ({ page }) => {
  await installPresets(page);
  await page.evaluate(inForm => {
    window.hostSubmits = 0;
    if (inForm) {
      const form = document.createElement('form');
      const bar = document.querySelector('.seerr-sort-filter-bar');
      bar.replaceWith(form); form.append(bar);
      form.addEventListener('submit', event => { event.preventDefault(); window.hostSubmits++; });
      const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = 'Search'; form.append(submit);
    }
  }, inForm);
  const name = page.getByLabel('Preset name');
  await name.fill('Weekend'); await name.focus();
  // Enter used to confirm composed text must not save the draft.
  await name.evaluate(node => node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })));
  expect(await page.evaluate(() => typeof window.finishPreset)).toBe('undefined');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Save preset', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.hostSubmits)).toBe(0);
  await page.evaluate(success => window.finishPreset(success
    ? { success: true, data: [{ name: 'Weekend', sort: 'default', filters: {} }] }
    : { success: false, error: 'Storage unavailable' }), success);
  await expect(page.getByRole('status')).toHaveText(success ? 'Saved Weekend' : 'Storage unavailable');
  await expect(page.getByLabel('Saved filter presets')).toHaveValue(success ? 'Weekend' : 'Night');
  await expect(name).toBeFocused();
});

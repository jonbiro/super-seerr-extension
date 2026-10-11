const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

async function install(page, surface) {
  const html = fs.readFileSync(`src/${surface}/${surface}.html`, 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  await page.setContent(html);
  await page.addStyleTag({ path: path.resolve(`src/${surface}/${surface}.css`) });
  await page.evaluate(() => {
    window.profiles = { revision: 1, activeId: 'home', sites: [
      { id: 'home', name: 'Home', url: 'https://home.example/', apiKey: 'fixture' }
    ] };
    window.chrome = {
      storage: { onChanged: { addListener() {} }, sync: { get: async () => ({}) },
        local: { get: async () => ({ seerrConnectionsV1: profiles }) } },
      permissions: { contains: async () => true },
      runtime: { sendMessage: async () => ({ success: false }) }
    };
  });
  const script = surface === 'popup' ? fs.readFileSync('src/popup/connections.js', 'utf8')
    : fs.readFileSync('src/options/options.js', 'utf8').split('// Initialize when DOM is loaded')[0] + '\nwindow.manager = new OptionsManager();';
  await page.addScriptTag({ content: script });
  await expect(page.locator('#retrySeerrSites')).toBeVisible();
  await expect(page.locator('#retrySeerrSites')).toBeEnabled();
  await page.evaluate(() => {
    chrome.runtime.sendMessage = () => new Promise(resolve => { window.finishSites = resolve; });
  });
}

for (const surface of ['popup', 'options']) for (const outcome of ['success', 'failure']) for (const moved of [false, true]) {
  test(`${surface} saved-site retry preserves focus (${outcome}, moved: ${moved})`, async ({ page }) => {
    await install(page, surface);
    const retry = page.locator('#retrySeerrSites');
    await retry.focus();
    await page.keyboard.press('Enter');
    await expect(retry).toBeDisabled();
    // Force the browser to process the disabled control's layout/focus state.
    await page.evaluate(() => document.body.getBoundingClientRect());
    const outside = surface === 'popup' ? page.locator('#openOptions') : page.locator('#serverUrl');
    if (moved) await outside.focus();
    await page.evaluate(outcome => finishSites(outcome === 'success'
      ? { success: true, data: profiles } : { success: false }), outcome);
    const target = moved ? outside : outcome === 'failure' ? retry
      : page.locator(surface === 'popup' ? '#activeSeerrSite' : '#savedSeerrSites');
    await expect(target).toBeFocused();
    if (outcome === 'success') await expect(retry).toBeHidden();
    else await expect(retry).toBeEnabled();
  });
}

test('popup retry with no saved sites moves focus to Settings', async ({ page }) => {
  await install(page, 'popup');
  await page.locator('#retrySeerrSites').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#retrySeerrSites')).toBeDisabled();
  await page.evaluate(() => finishSites({ success: true, data: { revision: 0, activeId: null, sites: [] } }));
  await expect(page.locator('#openOptions')).toBeFocused();
  await expect(page.locator('#seerrSiteSwitcher')).toBeHidden();
});

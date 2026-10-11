const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const html = fs.readFileSync('src/options/options.html', 'utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, '');
  await page.setContent(html);
  await page.addStyleTag({ path: path.resolve('src/options/options.css') });
  await page.evaluate(() => {
    window.chrome = {
      storage: { sync: { get: async () => ({}) }, local: { get: async () => ({}) } },
      permissions: { contains: async () => false }, runtime: { sendMessage: async () => ({ success: true, data: { sites: [], activeId: null } }) }
    };
  });
  await page.addScriptTag({ content: fs.readFileSync('src/options/options.js', 'utf8').split('// Initialize when DOM is loaded')[0] + '\nwindow.optionsManager = new OptionsManager();' });
  await expect(page.locator('#ratingsCacheCount')).toHaveText('No ratings cached');
});

test('revealing either credential preserves its full-size input and value', async ({ page }) => {
  for (const [id, name] of [['apiKey', 'Seerr API key'], ['plexToken', 'Plex token']]) {
    const field = page.locator(`#${id}`);
    await field.fill('test-value-'.repeat(20));
    // This fixture loads CSS after the markup, so let its initial style
    // transitions settle before comparing masked and revealed dimensions.
    await field.evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished)));
    const before = await field.boundingBox();
    await page.getByRole('button', { name: `Show ${name}`, exact: true }).click();
    await expect(field).toHaveAttribute('type', 'text');
    const after = await field.boundingBox();
    expect(after.width).toBeCloseTo(before.width, 1);
    expect(after.height).toBeCloseTo(before.height, 1);
    await expect(field).toHaveValue('test-value-'.repeat(20));
    await expect(field).toHaveCSS('border-radius', '8px');
    await field.focus();
    await expect(field).toHaveCSS('border-color', 'rgb(124, 58, 237)');
    await page.getByRole('button', { name: `Hide ${name}`, exact: true }).click();
    await expect(field).toHaveAttribute('type', 'password');
  }
});

test('settings hints and controls fit a narrow viewport without being clipped', async ({ page }) => {
  const overflow = await page.evaluate(() => [...document.querySelectorAll('input, fieldset, .plex-help code, .button')]
    .filter(node => { const r = node.getBoundingClientRect(); return r.width && (r.left < 0 || r.right > innerWidth); })
    .map(node => node.id || node.tagName));
  expect(overflow).toEqual([]);
});

test('saved-site failures offer a narrow-layout retry without discarding unsaved fields', async ({ page }) => {
  await page.evaluate(async () => {
    const data = { revision: 1, activeId: 'home', sites: [
      { id: 'home', name: 'Home', url: 'https://home.example/' },
      { id: 'family', name: 'Family', url: 'https://family.example/' }
    ] };
    chrome.runtime.sendMessage = async () => ({ success: true, data });
    window.optionsManager.connectionId = 'family';
    await window.optionsManager.loadConnectionChoices();
    chrome.runtime.sendMessage = async () => ({ success: false, error: 'Temporary failure' });
    await window.optionsManager.loadConnectionChoices();
    window.siteRecoveryReply = data;
  });
  await page.locator('#apiKey').fill('unsaved-family-key');
  await expect(page.locator('#seerrSitesError')).toBeVisible();
  await expect(page.locator('#useSeerrSite')).toBeDisabled();
  await expect(page.locator('#removeSeerrSite')).toBeDisabled();
  const retry = page.getByRole('button', { name: 'Retry saved sites', exact: true });
  await expect(retry).toBeEnabled();
  expect(await page.locator('.connection-options').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.locator('.connection-options').screenshot({ path: '/tmp/super-seerr-site-refresh-recovery.png' });
  await page.evaluate(() => { chrome.runtime.sendMessage = async () => ({ success: true, data: window.siteRecoveryReply }); });
  await retry.click();
  await expect(page.locator('#seerrSitesError')).toBeHidden();
  await expect(page.locator('#useSeerrSite')).toBeEnabled();
  await expect(page.locator('#removeSeerrSite')).toBeEnabled();
  await expect(page.locator('#savedSeerrSites')).toHaveValue('family');
  await expect(page.locator('#apiKey')).toHaveValue('unsaved-family-key');
});

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const controls = { save: 'button[type=submit]', test: '#testConnection', plex: '#testPlexConnection',
  reload: '#reloadSettings', cache: '#clearRatingsCache', edit: '#savedSeerrSites',
  use: '#useSeerrSite', remove: '#removeSeerrSite', grant: '#grantPermission' };

async function setup(page, action, success) {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.setContent(fs.readFileSync('src/options/options.html', 'utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, ''));
  await page.addStyleTag({ path: path.resolve('src/options/options.css') });
  await page.evaluate(({ action, success }) => {
    const home = 'https://home.example', family = 'https://family.example';
    const profiles = { revision: 1, activeId: home, sites: [
      { id: home, url: home, name: 'Home', apiKey: 'home-fixture' },
      { id: family, url: family, name: 'Family', apiKey: 'family-fixture' }
    ] };
    let hasCache = true, granted = action !== 'grant';
    const snapshot = () => ({ seerrConnectionsV1: structuredClone(profiles), plexToken: 'plex-fixture',
      ...(hasCache ? { overlayRatingsByServerV1: { [home]: { server: home, entries: { 'movie:1': {} } } } } : {}) });
    const reply = () => ({ success: true, data: structuredClone(profiles) });
    const delay = callback => new Promise((resolve, reject) => {
      window.finishSettingsAction = () => success ? resolve(callback()) : reject(new Error('Fixture temporarily unavailable'));
    });
    window.chrome = {
      permissions: { contains: async () => granted, request: () => window.settingsFocusAction === 'grant'
        ? new Promise(resolve => { window.finishSettingsAction = () => { granted = success; resolve(success); }; }) : Promise.resolve(true) },
      storage: { sync: { get: async () => ({}), set: async () => {} },
        local: { get: keys => window.settingsFocusAction === 'edit' && keys === 'seerrConnectionsV1' ? delay(snapshot) : Promise.resolve(snapshot()), set: async () => {} },
        onChanged: { addListener() {} } },
      runtime: { sendMessage: async message => {
        if (message.action === 'getSeerrConnections') return reply();
        const finish = () => {
          if (message.action === 'activateSeerrConnection') profiles.activeId = family;
          if (message.action === 'removeSeerrConnection') profiles.sites = profiles.sites.filter(site => site.id !== family);
          if (message.action === 'saveSeerrConnection') profiles.revision++;
          if (message.action === 'clearRatingsCache') hasCache = false;
          return ['saveSeerrConnection', 'activateSeerrConnection', 'removeSeerrConnection'].includes(message.action)
            ? reply() : { success: true, data: { user: 'Fixture viewer' } };
        };
        return window.settingsFocusAction && window.settingsFocusAction !== 'grant' ? delay(finish) : finish();
      } }
    };
  }, { action, success });
  await page.addScriptTag({ content: fs.readFileSync('src/options/options.js', 'utf8').split('// Initialize when DOM is loaded')[0] +
    '\nwindow.settingsManager = new OptionsManager();' });
  await expect(page.locator('#ratingsCacheCount')).toHaveText('1 cache entry');
  if (['use', 'remove'].includes(action)) {
    await page.locator('#savedSeerrSites').selectOption('https://family.example');
    await expect(page.locator('#apiKey')).toHaveValue('family-fixture');
    await expect(page.locator(controls[action])).toBeEnabled();
  }
  await page.evaluate(action => { window.settingsFocusAction = action; }, action);
}

for (const action of Object.keys(controls)) for (const success of [true, false]) {
  test(`settings ${action} preserves keyboard focus (success: ${success})`, async ({ page }) => {
    await setup(page, action, success);
    if (action === 'grant') await page.setViewportSize({ width: 320, height: 600 });
    const control = page.locator(controls[action]);
    await control.focus();
    if (action === 'edit') await control.selectOption('https://family.example');
    else await page.keyboard.press('Enter');
    await page.waitForFunction(() => typeof window.finishSettingsAction === 'function');
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await page.evaluate(() => finishSettingsAction());
    const target = !success ? control : ['use', 'remove'].includes(action) ? page.locator('#savedSeerrSites')
      : action === 'cache' ? page.locator('#ratingsCacheCount') : action === 'grant' ? page.locator('#serverUrl') : control;
    await expect(target).toBeFocused();
    await expect(target).toBeInViewport();
    if (action === 'cache' && success) {
      await expect(page.locator('#clearRatingsCache')).toBeDisabled();
      await page.keyboard.press('Tab');
      await expect(page.locator('#testConnection')).toBeFocused();
    }
  });
}

for (const action of ['save', 'use', 'grant']) for (const removed of [false, true]) {
  test(`settings ${action} respects a newer focus choice (removed: ${removed})`, async ({ page }) => {
    await setup(page, action, true);
    const control = page.locator(controls[action]);
    await control.focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => typeof window.finishSettingsAction === 'function');
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await page.evaluate(removed => {
      const other = document.createElement('button'); other.id = 'newer-focus'; other.textContent = 'Another action';
      document.body.append(other); other.focus();
      if (removed) other.remove();
    }, removed);
    await page.evaluate(() => finishSettingsAction());
    await expect(control).not.toBeFocused();
    if (!removed) await expect(page.locator('#newer-focus')).toBeFocused();
    else await expect(page.locator('body')).toBeFocused();
  });
}

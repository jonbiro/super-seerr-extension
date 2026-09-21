// Opt-in, read-only live smoke check. No real profile, credentials or writes.
// A blocked site is reported separately and is never counted as a pass.
const { chromium, expect } = require('@playwright/test');
const { createExtension } = require('./fixture.cjs');
const { SITES } = require('./site-fixtures.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const build = await createExtension('chrome');
  let context;
  const results = [];
  try {
    context = await chromium.launchPersistentContext(path.join(build.temporary, 'profile'), {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${build.extension}`, `--load-extension=${build.extension}`]
    });
    const cases = [...SITES, {
      site: 'tmdb', url: 'https://www.themoviedb.org/movie/550-fight-club?language=es-ES',
      expect: { title: 'El club de la lucha', mediaType: 'movie' }, locale: 'es-ES'
    }];
    const pages = new Map();
    const selectedSites = process.env.LIVE_SITES?.split(',');
    const selected = selectedSites ? cases.filter(site => selectedSites.includes(site.site)) : cases;
    if (!selected.length || selectedSites?.some(name => !cases.some(site => site.site === name))) throw new Error('Unknown LIVE_SITES selection');
    for (const site of selected) {
      let page = pages.get(site.site);
      const navigation = page ? 'same-tab navigation' : 'initial load';
      if (!page) { page = await context.newPage(); pages.set(site.site, page); }
      const result = { site: site.site, mediaType: site.expect.mediaType, locale: site.locale || (site.site === 'filmweb' ? 'pl-PL' : 'default'), navigation, requestedUrl: site.url, expectedTitle: site.site === 'filmweb' && site.expect.mediaType === 'movie' ? 'Fight Club' : site.expect.title };
      let stage = 'navigation';
      try {
        const response = await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        stage = 'extension';
        result.httpStatus = response?.status();
        result.finalUrl = page.url();
        if (result.httpStatus >= 400) {
          result.outcome = [401, 403, 429].includes(result.httpStatus) ? 'blocked' : 'site-unavailable';
          result.reason = `HTTP ${result.httpStatus}`;
          // Server errors must not create a requestable film title.
          await page.waitForTimeout(8000); // Observe the complete initialization retry window.
          await expect(page.locator('.seerr-flyout')).toHaveCount(0);
          result.noFalseTitle = true;
        } else {
          await expect(page.locator('.seerr-title')).toHaveText(result.expectedTitle, { timeout: 15000 });
          await expect(page.locator('.seerr-flyout')).toHaveCount(1);
          await expect(page.locator('.seerr-year')).toContainText(site.expect.mediaType === 'tv' ? 'TV Series' : 'Movie');
          // A short viewport catches layout changes without issuing any action.
          await page.setViewportSize({ width: 390, height: 600 });
          await page.locator('.seerr-tab').click();
          await expect(page.locator('.seerr-tab')).toHaveAttribute('aria-expanded', 'true');
          const panel = page.locator('.seerr-panel');
          await expect.poll(async () => {
            const bounds = await panel.boundingBox();
            result.panelBounds = bounds;
            return !!bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 391 && bounds.y + bounds.height <= 601;
          }, { timeout: 3000, message: 'Flyout extends outside the viewport after opening' }).toBe(true);
          result.layout = '390x600';
          await page.keyboard.press('Escape');
          result.outcome = 'pass';
        }
      } catch (error) {
        result.outcome = stage === 'navigation' ? 'site-unavailable' : 'failed'; result.error = error.message.split('\n').slice(0, 12).join('\n');
      }
      if (result.outcome === 'failed' && /onetrust-consent-sdk.*intercepts pointer events/.test(result.error || '')) {
        result.outcome = 'blocked'; result.reason = 'Host consent dialog requires a privacy choice';
      }
      result.pageTitle = await page.title().catch(() => null);
      if (result.outcome === 'failed' && /^(just a moment|access denied|attention required|verify you are human)/i.test(result.pageTitle || '')) {
        result.outcome = 'blocked'; result.reason = 'Access challenge';
      }
      result.extractedTitle = await page.locator('.seerr-title').textContent({ timeout: 500 }).catch(() => null);
      results.push(result); console.log(JSON.stringify(result));
      // Keep this tab for subsequent TV/localized navigation cases.
    }
    await fs.mkdir('test-results', { recursive: true });
    await fs.writeFile(`test-results/live-sites${selectedSites ? '-' + selectedSites.join('-') : ''}.json`, JSON.stringify({ checkedAt: new Date().toISOString(), version: build.manifest.version, browser: context.browser().version(), results }, null, 2));
    if (results.some(result => result.outcome !== 'pass')) process.exitCode = 1;
  } finally {
    await context?.close();
    await fs.rm(build.temporary, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

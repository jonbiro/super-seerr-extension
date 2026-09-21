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
    for (const site of SITES.filter((entry, index, entries) => entries.findIndex(other => other.site === entry.site) === index)) {
      const page = await context.newPage();
      const result = { site: site.site, requestedUrl: site.url, expectedTitle: site.site === 'filmweb' ? 'Fight Club' : site.expect.title };
      try {
        const response = await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        result.httpStatus = response?.status();
        result.finalUrl = page.url();
        if (result.httpStatus >= 400) {
          result.outcome = 'blocked';
          // Server errors must not create a requestable film title.
          await page.waitForTimeout(8000); // Observe the complete initialization retry window.
          await expect(page.locator('.seerr-flyout')).toHaveCount(0);
          result.noFalseTitle = true;
        } else {
          await expect(page.locator('.seerr-title')).toHaveText(result.expectedTitle, { timeout: 15000 });
          result.outcome = 'pass';
        }
      } catch (error) {
        result.outcome = 'failed'; result.error = error.message.split('\n')[0];
      }
      result.pageTitle = await page.title().catch(() => null);
      result.extractedTitle = await page.locator('.seerr-title').textContent({ timeout: 500 }).catch(() => null);
      results.push(result); console.log(JSON.stringify(result));
      await page.close();
    }
    await fs.mkdir('test-results', { recursive: true });
    await fs.writeFile('test-results/live-sites.json', JSON.stringify({ checkedAt: new Date().toISOString(), version: build.manifest.version, browser: context.browser().version(), results }, null, 2));
    if (results.some(result => result.outcome !== 'pass')) process.exitCode = 1;
  } finally {
    await context?.close();
    await fs.rm(build.temporary, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

const { test, expect, chromium } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createExtension, startServer } = require('./fixture.cjs');

test('a verified provider refresh updates two already open Seerr pages without replacing native scores', async () => {
  const server = await startServer(), build = await createExtension('chrome');
  let context;
  try {
    context = await chromium.launchPersistentContext(path.join(build.temporary, 'profile'), {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${build.extension}`, `--load-extension=${build.extension}`]
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    const manager = await context.newPage();
    await manager.goto('chrome://extensions');
    await manager.evaluate(id => chrome.developerPrivate.addHostPermission(id, 'http://127.0.0.1/*'), id);
    await manager.close();
    const options = await context.newPage();
    await options.goto(`chrome-extension://${id}/src/options/options.html`);
    await options.locator('#serverUrl').fill(server.origin);
    await options.locator('#apiKey').fill('smoke-key');
    await options.locator('button[type=submit]').click();
    await expect.poll(() => options.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).length)).toBe(2);
    const first = await context.newPage(), second = await context.newPage();
    for (const page of [first, second]) {
      await page.goto(`${server.origin}/discover`);
      await expect(page.locator('.seerr-card-badge').first()).toContainText('85%');
    }
    // Deterministic provider transport; parsing, public admission, persistence,
    // notifications and the installed content scripts all run unchanged.
    await worker.evaluate(() => {
      const original = globalThis.fetch;
      globalThis.fetch = (url, ...args) => String(url).startsWith('https://www.rottentomatoes.com/')
        ? Promise.resolve(new Response(String(url).includes('/search?')
          ? '<search-page-media-row release-year="1999" tomatometer-score="95"><a data-qa="info-name" href="/m/fight_club">Fight Club</a></search-page-media-row>'
          : '<script id="media-scorecard-json">{"audienceScore":{"score":92}}</script>', { status: 200 }))
        : original(url, ...args);
    });
    const result = await options.evaluate(async origin => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url === `${origin}/discover`);
      return (await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => chrome.runtime.sendMessage({
        action: 'getRottenTomatoesRatings', data: { tmdbId: 550, title: 'Fight Club', year: 1999, mediaType: 'movie', refresh: true }
      }) }))[0].result;
    }, server.origin);
    expect(result.success).toBe(true);
    for (const page of [first, second]) {
      await expect(page.locator('.seerr-card-badge').first()).toContainText('95%');
    }
    const nativeScores = await options.evaluate(async origin => {
      const tabs = (await chrome.tabs.query({})).filter(tab => tab.url === `${origin}/discover`);
      return Promise.all(tabs.map(async tab => (await chrome.scripting.executeScript({ target: { tabId: tab.id },
        func: () => document.querySelector('[data-testid="title-card"]').__seerrRatings.imdbRating }))[0].result));
    }, server.origin);
    expect(nativeScores).toEqual([8, 8]);
  } finally {
    await context?.close();
    await new Promise(resolve => server.server.close(resolve));
    await fs.rm(build.temporary, { recursive: true, force: true });
  }
});

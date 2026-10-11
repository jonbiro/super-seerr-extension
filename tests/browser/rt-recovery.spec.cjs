const { test, expect, chromium } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const Config = require('../../src/shared/RatingsConfig');
const { createExtension } = require('./fixture.cjs');

test('persisted RT failures recover and failed refreshes preserve the last successful score', async () => {
  const build = await createExtension('chrome');
  let context;
  try {
    context = await chromium.launchPersistentContext(path.join(build.temporary, 'profile'), {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${build.extension}`, `--load-extension=${build.extension}`]
    });
    let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const options = await context.newPage();
    await options.goto(`chrome-extension://${new URL(worker.url()).host}/src/options/options.html`);
    await options.evaluate(async ({ matcher, retry, negativeTtl }) => {
      const checkedAt = Date.now() - retry - 1000;
      await chrome.storage.local.set({ rtCacheV1: { matcher, entries: {
        'movie:Fight Club:1999': { checkedAt, expiresAt: checkedAt + negativeTtl, diagnostic: 'failed',
          value: { rtCriticsScore: 80, rtAudienceScore: null, confidence: 1, source: 'rotten-tomatoes',
            matchedTitle: 'Fight Club', matchedYear: 1999, url: '/m/fight_club' } }
      } } });
    }, { matcher: Config.matcherVersion, retry: Config.inconclusiveRetryMs, negativeTtl: Config.rtNegativeCacheTtlMs });
    const cdp = await context.newCDPSession(options);
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.stopAllWorkers');
    await options.evaluate(() => chrome.runtime.sendMessage({ action: 'getConfigState' }));
    await cdp.detach();
    worker = context.serviceWorkers()[0];
    // Exercise the actual worker, parsing, messages and storage using a
    // deterministic public-provider transport. No live RT access is claimed.
    await worker.evaluate(() => {
      const originalFetch = globalThis.fetch;
      globalThis.rtProbe = { calls: 0, mode: 'healthy' };
      globalThis.fetch = (url, ...args) => {
        if (!String(url).startsWith('https://www.rottentomatoes.com/')) return originalFetch(url, ...args);
        rtProbe.calls++;
        const search = String(url).includes('/search?');
        if (rtProbe.mode === 'offline' || (rtProbe.mode === 'detail-failure' && !search)) {
          return Promise.reject(new Error('Provider temporarily unavailable'));
        }
        return Promise.resolve(new Response(search
          ? '<search-page-media-row release-year="1999" tomatometer-score="95"><a data-qa="info-name" href="/m/fight_club">Fight Club</a></search-page-media-row>'
          : '<script id="media-scorecard-json" type="application/json">{"audienceScore":{"score":90}}</script>', { status: 200 }));
      };
    });
    const lookup = refresh => options.evaluate(refresh => chrome.runtime.sendMessage({ action: 'getRottenTomatoesRatings',
      data: { title: 'Fight Club', year: 1999, mediaType: 'movie', refresh } }), refresh);
    const recovered = await lookup(false);
    expect(recovered.success).toBe(true);
    expect(recovered.data).toMatchObject({ rtCriticsScore: 95, rtAudienceScore: 90, diagnostic: 'rated' });
    expect(await worker.evaluate(() => rtProbe.calls)).toBe(2);
    const persisted = () => options.evaluate(async () => (await chrome.storage.local.get('rtCacheV1')).rtCacheV1.entries['movie:Fight Club:1999']);
    await expect.poll(async () => (await persisted())?.value.rtAudienceScore).toBe(90);
    const original = await persisted();
    await worker.evaluate(() => { rtProbe.mode = 'offline'; });
    expect((await lookup(true)).success).toBe(false);
    expect((await lookup(false)).data).toEqual(recovered.data);
    expect(await worker.evaluate(() => rtProbe.calls)).toBe(3);
    await worker.evaluate(() => { rtProbe.mode = 'detail-failure'; });
    expect((await lookup(true)).data).toMatchObject({ diagnostic: 'failed', rtAudienceScore: null });
    expect((await lookup(false)).data).toEqual(recovered.data);
    expect(await worker.evaluate(() => rtProbe.calls)).toBe(5);
    expect(await persisted()).toEqual(original);
    // A second client sees the same successful title cache. ID-bound public
    // admission is exercised separately from configured Seerr pages.
    const sibling = await context.newPage();
    await sibling.goto(options.url());
    const shared = await sibling.evaluate(() => chrome.runtime.sendMessage({ action: 'getRottenTomatoesRatings',
      data: { title: 'Fight Club', year: 1999, mediaType: 'movie' } }));
    expect(shared.data).toEqual(recovered.data);
    expect(await worker.evaluate(() => rtProbe.calls)).toBe(5);
  } finally {
    await context?.close();
    await fs.rm(build.temporary, { recursive: true, force: true });
  }
});

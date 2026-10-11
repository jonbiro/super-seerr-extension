const { test, expect, chromium } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createExtension, startServer } = require('./fixture.cjs');

test('save, switch, edit, and remove a second Seerr site without mixing API keys', async () => {
  test.setTimeout(120000);
  const first = await startServer(), second = await startServer();
  const build = await createExtension('chrome');
  let context;
  const requests = [];
  first.server.on('request', request => requests.push({ site: 'Home', path: request.url, key: request.headers['x-api-key'] }));
  second.server.on('request', request => requests.push({ site: 'Family', path: request.url, key: request.headers['x-api-key'] }));
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
    await options.setViewportSize({ width: 320, height: 700 });
    await options.goto(`chrome-extension://${id}/src/options/options.html`);
    await expect(options.locator('#ratingsCacheCount')).toHaveText('No ratings cached');
    await options.locator('#seerrSiteName').fill('Home');
    await options.locator('#serverUrl').fill(first.origin);
    await options.locator('#apiKey').fill('initial-home-key');
    await options.locator('button[type=submit]').click();
    await expect(options.locator('#activeSeerrSite')).toContainText('Active site: Home');
    // Once a named site exists, clearing its name must still edit the saved
    // profile rather than writing an ignored legacy key.
    await options.locator('#seerrSiteName').fill('');
    await options.locator('#apiKey').fill('home-key');
    await options.locator('button[type=submit]').click();
    await expect(options.locator('#activeSeerrSite')).toContainText('Active site: 127.0.0.1');
    await options.locator('#seerrSiteName').fill('Home');
    await options.locator('button[type=submit]').click();
    await expect(options.locator('#activeSeerrSite')).toContainText('Active site: Home');
    await options.getByRole('button', { name: 'Add another site', exact: true }).click();
    await expect(options.locator('#apiKey')).toHaveValue('');
    await options.locator('#seerrSiteName').fill('Family');
    await options.locator('#serverUrl').fill(second.origin);
    await options.locator('#apiKey').fill('family-key');
    await options.locator('button[type=submit]').click();
    await expect(options.locator('#activeSeerrSite')).toContainText('Active site: Family');
    await expect(options.locator('#savedSeerrSites option')).toHaveCount(2);
    await options.getByRole('button', { name: 'Test Connection', exact: true }).click();
    await expect(options.locator('#status')).toContainText('Connected');
    expect(requests.filter(r => r.path === '/api/v1/auth/me').at(-1)).toMatchObject({ site: 'Family', key: 'family-key' });
    const familyRequest = await options.evaluate(async () => chrome.runtime.sendMessage({ action: 'requestMedia', data: { tmdbId: 550, mediaType: 'movie', title: 'Fight Club' } }));
    expect(familyRequest.success).toBe(true);
    // Seed a verified provider fixture, then restart the actual worker to
    // exercise the persisted public tier rather than its in-memory state.
    await options.evaluate(async matcher => {
      const checkedAt = Date.now();
      await chrome.storage.local.set({ publicRatingsV1: { matcher, entries: { 'movie:550': {
        source: 'rotten-tomatoes', checkedAt, expiresAt: checkedAt + 86400000,
        value: { source: 'rotten-tomatoes', confidence: 1, rtCriticsScore: 62, rtAudienceScore: 73,
          matchedTitle: 'Fight Club', matchedYear: 1999, url: 'https://www.rottentomatoes.com/m/fight_club' }
      } } } });
    }, require('../../src/shared/RatingsConfig').matcherVersion);
    const seedSession = await context.newCDPSession(options);
    await seedSession.send('ServiceWorker.enable');
    await seedSession.send('ServiceWorker.stopAllWorkers');
    await options.evaluate(() => chrome.runtime.sendMessage({ action: 'getConfigState' }));
    await seedSession.detach();
    const seerr = await context.newPage();
    await seerr.goto(`${second.origin}/discover`);
    await expect(seerr.locator('.seerr-card-badge')).toHaveCount(2);
    const cachedSites = () => options.evaluate(async () => (await chrome.storage.local.get('overlayRatingsByServerV1')).overlayRatingsByServerV1 || {});
    await expect.poll(async () => Object.keys((await cachedSites())[second.origin]?.entries || {})).toContain('movie:550');
    expect((await cachedSites())[second.origin].entries['movie:550'].bundle.rtCriticsScore).toBe(62);
    expect((await cachedSites())[second.origin].entries['movie:550'].bundle.imdbRating).toBe(8);
    await expect(options.locator('#ratingsCacheCount')).toHaveText(/\d+ cache entries/);
    await expect(options.locator('#clearRatingsCache')).toBeEnabled();
    // Overlapping catalogue responses must persist the newest identity, even
    // when a later minimal request response omits its poster and release date.
    const addPosterOnlyCard = () => {
      const card = document.createElement('article');
      card.dataset.testid = 'title-card'; card.id = 'updated-catalogue-card';
      card.innerHTML = '<img alt="" src="/catalogue-updated.jpg">';
      document.querySelector('main .grid').append(card);
    };
    await seerr.evaluate(addPosterOnlyCard);
    await seerr.evaluate(() => {
      for (const item of [
        { id: 444444, mediaType: 'movie', title: 'Old catalogue title', posterPath: '/catalogue-old.jpg', releaseDate: '2020-01-01' },
        { id: 444444, mediaType: 'movie', title: 'Updated catalogue title', posterPath: '/catalogue-updated.jpg', releaseDate: '2021-01-01',
          rtCriticsScore: 71, rtAudienceScore: 82, imdbRating: 8, voteAverage: 8 },
        { media: { tmdbId: 444444, mediaType: 'movie', title: 'Updated catalogue title' } }
      ]) window.postMessage({ channel: 'super-seerr:api', url: '/api/v1/discover/movies', items: [item] }, location.origin);
    });
    await expect.poll(async () => (await cachedSites())[second.origin]?.index.find(item => item.tmdbId === '444444'))
      .toMatchObject({ title: 'Updated catalogue title', posterPath: '/catalogue-updated.jpg', year: 2021 });
    await seerr.reload();
    await seerr.evaluate(addPosterOnlyCard);
    await expect(seerr.locator('#updated-catalogue-card .seerr-card-badge').first()).toBeVisible();
    await seerr.evaluate(() => window.postMessage({ channel: 'super-seerr:api', url: '/api/v1/discover/movies', items: [
      { id: 555555, mediaType: 'movie', title: 'Recycled title', posterPath: '/catalogue-recycled.jpg', releaseDate: '2022-01-01',
        rtCriticsScore: 96, rtAudienceScore: 82, imdbRating: 8, voteAverage: 8 }
    ] }, location.origin));
    // Let the real MutationObserver detect a poster change without mounting a
    // link or manually calling an injection helper.
    await seerr.locator('#updated-catalogue-card img').evaluate(image => { image.src = '/catalogue-recycled.jpg'; });
    await expect(seerr.locator('#updated-catalogue-card .seerr-card-badge').first()).toContainText('96%');
    await expect.poll(async () => (await cachedSites())[second.origin]?.index.some(item => item.tmdbId === '555555')).toBe(true);
    await seerr.locator('#updated-catalogue-card img').evaluate(image => { image.src = '/catalogue-unobserved.jpg'; });
    await expect(seerr.locator('#updated-catalogue-card .seerr-card-badge')).toHaveCount(0);
    await seerr.locator('#updated-catalogue-card').evaluate(node => node.remove());
    // Two independently loaded cache clients must preserve each other's
    // ratings and title indexes while using the real worker/storage bridge.
    const sibling = await context.newPage();
    await sibling.goto(`${second.origin}/discover?cache-probe=second`);
    await expect(sibling.locator('.seerr-card-badge')).toHaveCount(2);
    await options.evaluate(async origin => {
      const tabs = (await chrome.tabs.query({})).filter(tab => tab.url?.startsWith(`${origin}/discover`));
      const checkedAt = Date.now();
      await Promise.all(tabs.map(tab => chrome.scripting.executeScript({ target: { tabId: tab.id }, args: [checkedAt], func: async checkedAt => {
        const id = location.search ? '222222' : '111111';
        window.cacheProbe = window.createOverlayCache({ Config: window.RatingsConfig, Model: window.RatingsModel,
          log() {}, getServer: () => new URL(location.origin),
          getListIndex: () => [{ tmdbId: id, mediaType: 'movie', title: `Tab ${id}` }], restoreListIndex() {} });
        await window.cacheProbe.loadPersistedRatings();
        window.cacheProbe.ratingsCache.set(`movie:${id}`, { bundle: window.RatingsModel.createRatingsBundle({ rtCriticsScore: Number(id[0]) * 10 }), cachedAt: Date.now() });
        const publicUpdate = !!location.search;
        window.cacheProbe.ratingsCache.set('movie:333333', {
          bundle: window.RatingsModel.createRatingsBundle({ rtCriticsScore: publicUpdate ? 95 : 20,
            imdbRating: publicUpdate ? 7 : 9, confidence: 1 }),
          cachedAt: checkedAt - (publicUpdate ? 10000 : 1000), publicCheckedAt: checkedAt - (publicUpdate ? 0 : 20000)
        });
      } })));
      await Promise.all(tabs.map(tab => chrome.scripting.executeScript({ target: { tabId: tab.id },
        func: () => window.cacheProbe.flushPersistedRatings() })));
    }, second.origin);
    expect((await cachedSites())[second.origin].entries['movie:111111'].bundle.rtCriticsScore).toBe(10);
    expect((await cachedSites())[second.origin].entries['movie:222222'].bundle.rtCriticsScore).toBe(20);
    expect((await cachedSites())[second.origin].entries['movie:333333'].bundle).toMatchObject({ rtCriticsScore: 95, imdbRating: 9 });
    expect((await cachedSites())[second.origin].index.map(item => item.tmdbId)).toEqual(expect.arrayContaining(['111111', '222222']));
    await sibling.close();
    expect(await options.locator('.connection-options').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await options.locator('.connection-options').screenshot({ path: '/tmp/super-seerr-multiple-sites-settings.png' });

    const popup = await context.newPage();
    await popup.setViewportSize({ width: 320, height: 400 });
    await popup.goto(`chrome-extension://${id}/src/popup/popup.html`);
    await expect(popup.locator('#activeSeerrSite')).toHaveValue(second.origin);
    await options.locator('#apiKey').fill('unsaved-family-key');
    await popup.locator('#activeSeerrSite').selectOption(first.origin);
    await expect(popup.locator('#siteSwitchStatus')).toContainText('Site switched');
    await expect(options.locator('#activeSeerrSite')).toContainText('Active site: Home');
    await expect(options.locator('#savedSeerrSites')).toHaveValue(second.origin);
    await expect(options.locator('#serverUrl')).toHaveValue(second.origin);
    await expect(options.locator('#apiKey')).toHaveValue('unsaved-family-key');
    await expect(options.getByRole('button', { name: 'Use selected site', exact: true })).toBeEnabled();
    expect(await options.locator('.connection-options').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await options.locator('.connection-options').screenshot({ path: '/tmp/super-seerr-multiple-sites-settings.png' });
    await expect(popup.locator('#diagnosticChecks')).toContainText('API key: OK');
    const result = await popup.evaluate(async () => chrome.runtime.sendMessage({ action: 'testConnection' }));
    expect(result.success).toBe(true);
    expect(requests.filter(r => r.path === '/api/v1/auth/me').at(-1)).toMatchObject({ site: 'Home', key: 'home-key' });
    await expect(seerr.locator('.seerr-card-badge')).toHaveCount(0);
    const homePage = await context.newPage();
    await homePage.goto(`${first.origin}/discover`);
    await expect(homePage.locator('.seerr-card-badge')).toHaveCount(2);
    await expect.poll(async () => Object.keys((await cachedSites())[first.origin]?.entries || {})).toContain('movie:550');
    await homePage.close();
    expect(Object.keys(await cachedSites()).sort()).toEqual([first.origin, second.origin].sort());
    expect((await cachedSites())[first.origin].entries['movie:550'].bundle.rtCriticsScore).toBe(62);
    await options.evaluate(async () => {
      const { publicRatingsV1: shared } = await chrome.storage.local.get('publicRatingsV1');
      const entry = shared.entries['movie:550'];
      entry.checkedAt = Date.now(); entry.expiresAt = entry.checkedAt + 86400000;
      entry.value.rtCriticsScore = 95;
      await chrome.storage.local.set({ publicRatingsV1: shared });
    });
    const cdp = await context.newCDPSession(options);
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.stopAllWorkers');
    await options.evaluate(() => chrome.runtime.sendMessage({ action: 'getConfigState' }));
    await cdp.detach();
    expect(Object.keys(await cachedSites()).sort()).toEqual([first.origin, second.origin].sort());
    const homeRequest = await popup.evaluate(async () => chrome.runtime.sendMessage({ action: 'requestMedia', data: { tmdbId: 550, mediaType: 'movie', title: 'Fight Club' } }));
    expect(homeRequest.success).toBe(true);
    await popup.screenshot({ path: '/tmp/super-seerr-multiple-sites-popup.png' });

    // Reload proves the worker-owned record, not a form draft, holds the key.
    await options.reload();
    await expect(options.locator('#apiKey')).toHaveValue('home-key');
    await options.locator('#savedSeerrSites').selectOption(second.origin);
    await expect(options.locator('#apiKey')).toHaveValue('family-key');
    await options.getByRole('button', { name: 'Use selected site', exact: true }).click();
    await expect(options.locator('#activeSeerrSite')).toContainText('Active site: Family');
    await expect(seerr.locator('.seerr-card-badge')).toHaveCount(2);
    expect((await cachedSites())[first.origin].entries['movie:550']).toBeTruthy();
    expect((await cachedSites())[second.origin].entries['movie:550']).toBeTruthy();
    await expect.poll(async () => (await cachedSites())[second.origin].entries['movie:550'].bundle.rtCriticsScore).toBe(95);
    expect((await cachedSites())[second.origin].entries['movie:550'].bundle.imdbRating).toBe(8);
    await expect(popup.locator('#activeSeerrSite')).toHaveValue(second.origin);
    await expect(popup.locator('#activeSeerrSite')).toHaveAttribute('title', second.origin);
    await expect(popup.locator('#serverUrl')).toContainText(new URL(second.origin).host);
    await options.locator('#savedSeerrSites').selectOption(first.origin);
    await options.getByRole('button', { name: 'Remove selected site', exact: true }).click();
    await expect(options.locator('#savedSeerrSites option')).toHaveCount(1);
    await expect(options.locator('#activeSeerrSite')).toContainText('Active site: Family');
    const storage = await options.evaluate(async () => ({ sync: await chrome.storage.sync.get(null), local: await chrome.storage.local.get('seerrConnectionsV1') }));
    expect(JSON.stringify(storage.sync)).not.toContain('-key');
    expect(JSON.stringify(storage.local)).not.toContain('home-key');
    await expect(popup.locator('#activeSeerrSite option')).toHaveCount(1);
    // A child installation on a shared origin must not inherit the parent.
    const child = `${second.origin}/movie`;
    await options.evaluate(async child => {
      const saved = await chrome.runtime.sendMessage({ action: 'saveSeerrConnection', data: { url: child, name: 'Nested site', apiKey: 'child-key' } });
      if (!saved.success) throw new Error(saved.error);
    }, child);
    await options.evaluate(async parent => {
      await chrome.runtime.sendMessage({ action: 'activateSeerrConnection', data: { id: parent } });
    }, second.origin);
    await expect(seerr.locator('.seerr-card-badge')).toHaveCount(2);
    await seerr.evaluate(() => history.pushState({}, '', '/movie/550'));
    await expect(seerr.locator('[data-seerr-overlay=true]')).toHaveCount(0);
    await seerr.evaluate(() => history.back());
    await expect(seerr.locator('.seerr-card-badge')).toHaveCount(2);
    await seerr.goto(`${child}/550`);
    await expect(seerr.locator('[data-seerr-overlay=true]')).toHaveCount(0);
    const cacheReply = await options.evaluate(async pageUrl => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find(tab => tab.url === pageUrl);
      const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => chrome.runtime.sendMessage({ action: 'getOverlayCache' }) });
      return results[0].result;
    }, `${child}/550`);
    expect(cacheReply.success).toBe(false);
    expect(cacheReply.error).toContain('not the active');
    // Activate the nested installation. Its own anchored cards must work,
    // while a same-origin link to the parent must not inherit a badge.
    await options.evaluate(async child => {
      await chrome.runtime.sendMessage({ action: 'activateSeerrConnection', data: { id: child } });
    }, child);
    await seerr.goto(`${child}/discover`);
    await seerr.evaluate(() => {
      const card = document.querySelector('[data-testid="title-card"]');
      card.id = 'nested-title'; card.querySelector('a').href = '/movie/movie/550';
      const parent = document.createElement('article');
      parent.dataset.testid = 'title-card'; parent.id = 'parent-title';
      parent.innerHTML = '<a href="/movie/550">Fight Club</a>';
      card.parentElement.append(parent);
    });
    await expect(seerr.locator('#nested-title .seerr-card-badge')).toHaveCount(2);
    await expect(seerr.locator('#parent-title .seerr-card-badge')).toHaveCount(0);
    await expect.poll(async () => (await cachedSites())[child]?.entries['movie:550']?.bundle.rtCriticsScore).toBe(95);
    await seerr.locator('#nested-title a').evaluate(link => { link.href = '/movie/550'; });
    await expect(seerr.locator('#nested-title .seerr-card-badge')).toHaveCount(0);
    await seerr.locator('#nested-title a').evaluate(link => { link.href = '/movie/movie/550'; });
    await expect(seerr.locator('#nested-title .seerr-card-badge')).toHaveCount(2);
    await seerr.route(`${child}/api/v1/movie/777/ratingscombined`, route => route.fulfill({
      status: 302, headers: { location: `${second.origin}/api/v1/movie/777/ratingscombined` }, body: ''
    }));
    const redirectedRead = await options.evaluate(async pageUrl => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url === pageUrl);
      const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: async () => {
        const session = window.createSeerrSession({ Config: window.RatingsConfig, Model: window.RatingsModel,
          log() {}, getServer: () => new URL(`${location.origin}/movie`) });
        try { await session.fetchJsonFromSeerr('/api/v1/movie/777/ratingscombined'); return { blocked: false }; }
        catch (_) { return { blocked: true }; }
      } });
      return results[0].result;
    }, `${child}/discover`);
    expect(redirectedRead.blocked).toBe(true);
    expect(requests.some(request => request.path === '/api/v1/movie/777/ratingscombined')).toBe(false);
    expect(requests.filter(r => r.key && ((r.site === 'Home' && !['home-key', 'initial-home-key'].includes(r.key)) || (r.site === 'Family' && r.key !== (r.path.startsWith('/movie/api/') ? 'child-key' : 'family-key'))))).toEqual([]);
    await seerr.close();
    expect(await options.evaluate(() => chrome.runtime.sendMessage({ action: 'clearRatingsCache' }))).toEqual({ success: true });
    expect(await cachedSites()).toEqual({});
    expect(await options.evaluate(async () => (await chrome.storage.local.get('publicRatingsV1')).publicRatingsV1)).toBeUndefined();
    await expect(options.locator('#ratingsCacheCount')).toHaveText('No ratings cached');
    await expect(options.locator('#clearRatingsCache')).toBeDisabled();
  } finally {
    await context?.close();
    await Promise.all([new Promise(resolve => first.server.close(resolve)), new Promise(resolve => second.server.close(resolve))]);
    await fs.rm(build.temporary, { recursive: true, force: true });
  }
});

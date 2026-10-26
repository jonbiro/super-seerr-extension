const { test, expect, chromium } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createExtension, startServer } = require('./fixture.cjs');

test('packaged Simkl reviews isolate pages through worker restart and keep provider fixtures private until disconnect', async () => {
  const build = await createExtension('chrome');
  const { server, origin } = await startServer();
  let context;
  try {
    context = await chromium.launchPersistentContext(path.join(build.temporary, 'profile'), {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${build.extension}`, `--load-extension=${build.extension}`]
    });
    let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    const manager = await context.newPage(); await manager.goto('chrome://extensions');
    await manager.evaluate(async ({ id, origin }) => {
      for (const pattern of ['https://api.simkl.com/*', 'https://simkl.com/*', `${origin}/*`]) {
        await chrome.developerPrivate.addHostPermission(id, pattern);
      }
    }, { id, origin: new URL(origin).origin.replace(/:\d+$/, '') });
    await manager.close();
    const first = await context.newPage();
    await first.goto(`chrome-extension://${id}/src/options/options.html`);
    await first.locator('#serverUrl').fill(origin);
    await first.locator('#apiKey').fill('fixture-seerr-key');
    await first.locator('button[type="submit"]').click();
    await expect(first.locator('#status')).toContainText('Settings saved successfully');
    await first.evaluate(() => chrome.storage.local.set({ trackerAccountsV1: { simkl: {
      clientId: 'fixture-app', accessToken: 'fixture-access', refreshToken: 'fixture-refresh',
      expiresAt: Date.now() + 3600000, accountRevision: 'same-fixture-account'
    } } }));
    const second = await context.newPage();
    await second.goto(`chrome-extension://${id}/src/options/options.html`);
    await worker.evaluate(() => {
      globalThis.reviewRevision = 'Earlier';
      const original = fetch;
      globalThis.fetch = async (value, options) => {
        const url = new URL(value);
        if (url.origin !== 'https://api.simkl.com') return original(value, options);
        if (options.method !== 'GET') throw new Error('The watchlist review must not write provider data');
        const data = url.pathname === '/sync/activities' ? { all: reviewRevision }
          : url.pathname.includes('/movies/') ? { movies: Array.from({ length: 150 }, (_, i) => ({
            status: 'plantowatch', movie: { title: `${reviewRevision} film ${i}`, year: 2020 }
          })) } : {};
        return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
      };
    });
    const firstCard = first.locator('[data-tracker="simkl"]'), secondCard = second.locator('[data-tracker="simkl"]');
    await expect(firstCard.getByRole('button', { name: 'Sync watchlist', exact: true })).toBeEnabled();
    await firstCard.getByRole('button', { name: 'Sync watchlist', exact: true }).click();
    await expect(firstCard.locator('.tracker-watchlist li')).toHaveCount(100);

    const host = await context.newPage(); await host.goto(origin); await host.bringToFront();
    expect(await first.evaluate(() => chrome.permissions.contains({ origins: ['http://127.0.0.1/*'] }))).toBe(true);
    const tabId = await first.evaluate(async () => (await chrome.tabs.query({ url: 'http://127.0.0.1/*' }))[0].id);
    const probe = await first.evaluate(async tabId => {
      const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: async () => {
        let denied = false;
        try { await chrome.storage.session.get('simklWatchlistSnapshotsV1'); } catch (_) { denied = true; }
        document.body.dataset.privateSessionChange = 'no';
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area === 'session') document.body.dataset.privateSessionChange = 'yes';
        });
        const reply = await chrome.runtime.sendMessage({ action: 'getTrackerWatchlist', data: { provider: 'simkl' } });
        return { denied, messageDenied: !reply.success };
      } }); return result.result;
    }, tabId);
    expect(probe).toEqual({ denied: true, messageDenied: true });
    await first.evaluate(async () => {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'session' && changes.privateProbeV1) window.privateProbeObserved = true;
      });
      await chrome.storage.session.set({ privateProbeV1: 'fixture-private' });
    });
    await expect.poll(() => first.evaluate(() => window.privateProbeObserved)).toBe(true);
    await expect(host.locator('body')).toHaveAttribute('data-private-session-change', 'no');

    await worker.evaluate(() => { globalThis.reviewRevision = 'Later'; });
    await secondCard.getByRole('button', { name: 'Sync watchlist', exact: true }).click();
    await expect(secondCard.locator('.tracker-watchlist li')).toHaveCount(100);
    await firstCard.getByRole('button', { name: 'Load more titles', exact: true }).click();
    await expect(firstCard.locator('.tracker-watchlist li')).toHaveCount(150);
    await expect(firstCard.locator('.tracker-watchlist li').last()).toContainText('Earlier film 149');
    await expect(host.locator('body')).toHaveAttribute('data-private-session-change', 'no');
    const stored = await first.evaluate(async () => ({ session: await chrome.storage.session.get(), local: await chrome.storage.local.get() }));
    expect(JSON.stringify(stored.session)).toContain('Earlier film 149');
    expect(JSON.stringify(stored.session)).not.toMatch(/fixture-access|fixture-refresh/);
    expect(stored.local.simklWatchlistSnapshotsV1).toBeUndefined();

    const cdp = await context.newCDPSession(first);
    await worker.evaluate(() => { globalThis.reviewWorkerMarker = 'before-restart'; });
    const versions = [];
    cdp.on('ServiceWorker.workerVersionUpdated', event => versions.push(...event.versions));
    await cdp.send('ServiceWorker.enable'); await cdp.send('ServiceWorker.stopAllWorkers');
    await expect.poll(() => versions.some(version => version.scriptURL.includes(id) && version.runningStatus === 'stopped')).toBe(true);
    await first.evaluate(() => chrome.runtime.sendMessage({ action: 'ping' }));
    await expect.poll(async () => {
      const current = context.serviceWorkers().find(item => new URL(item.url()).host === id);
      if (!current) return false;
      try {
        const fresh = await current.evaluate(() => typeof globalThis.reviewWorkerMarker === 'undefined');
        if (fresh) worker = current;
        return fresh;
      } catch (_) { return false; }
    }).toBe(true);
    await cdp.detach();
    await worker.evaluate(() => {
      const original = fetch;
      globalThis.fetch = (value, options) => {
        if (new URL(value).origin === 'https://api.simkl.com') throw new Error('Pagination must use its retained session snapshot');
        return original(value, options);
      };
    });
    await secondCard.getByRole('button', { name: 'Load more titles', exact: true }).click();
    await expect(secondCard.locator('.tracker-watchlist li')).toHaveCount(150);
    await expect(secondCard.locator('.tracker-watchlist li').last()).toContainText('Later film 149');
    await secondCard.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(firstCard.locator('.tracker-watchlist li')).toHaveCount(0);
    await expect(secondCard.locator('.tracker-watchlist li')).toHaveCount(0);
    expect(await first.evaluate(async () => (await chrome.storage.session.get('simklWatchlistSnapshotsV1')).simklWatchlistSnapshotsV1)).toBeUndefined();
  } finally {
    await context?.close();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(build.temporary, { recursive: true, force: true });
  }
});

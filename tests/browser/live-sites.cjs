// Opt-in, read-only live smoke check. No real profile, credentials or writes.
// A blocked site is reported separately and is never counted as a pass.
const { chromium, expect } = require('@playwright/test');
const { createExtension } = require('./fixture.cjs');
const { SITES } = require('./site-fixtures.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');

async function verifySmallViewportFlyout(page, result) {
  await page.setViewportSize({ width: 390, height: 600 });
  // A host consent layer can intercept the pointer. Keep the check read-only
  // and classify that block promptly instead of waiting for Playwright's
  // much longer default click timeout.
  await page.locator('.seerr-tab').click({ timeout: 3000 });
  await expect(page.locator('.seerr-tab')).toHaveAttribute('aria-expanded', 'true');
  const panel = page.locator('.seerr-panel');
  await expect.poll(async () => {
    if (await page.locator('.seerr-tab').getAttribute('aria-expanded') !== 'true') return false;
    const bounds = await panel.boundingBox();
    result.panelBounds = bounds;
    return !!bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 391 && bounds.y + bounds.height <= 601;
  }, { timeout: 3000, message: 'Flyout extends outside the viewport after opening' }).toBe(true);
  result.layout = '390x600';
  // A provider can open its own consent/login dialog while the panel is open,
  // moving focus outside the extension. Restore the panel's documented focus
  // target so this assertion tests the extension's Escape handling rather than
  // whichever host dialog happened to win focus during the live check.
  await panel.press('Escape');
  await expect(page.locator('.seerr-tab')).toHaveAttribute('aria-expanded', 'false');
}

async function waitForStableFlyout(page, expectedTitle, result) {
  const deadline = Date.now() + 12000;
  let replacedPanels = 0;
  let previousPanelId = null;
  const urls = new Set([page.url()]);
  await page.evaluate(() => {
    window.__seerrFlyoutEvents = [];
    window.__seerrFlyoutIds = new WeakMap();
    window.__seerrNextFlyoutId = 0;
    const findFlyouts = root => {
      if (root.nodeType !== Node.ELEMENT_NODE) return [];
      return [...(root.matches('.seerr-flyout') ? [root] : []), ...root.querySelectorAll('.seerr-flyout')];
    };
    window.__seerrFlyoutObserver = new MutationObserver(records => {
      for (const record of records) {
        for (const [action, nodes] of [['removed', record.removedNodes], ['added', record.addedNodes]]) {
          for (const root of nodes) for (const flyout of findFlyouts(root)) {
            window.__seerrFlyoutEvents.push({ action, url: location.href,
              title: flyout.querySelector('.seerr-title')?.textContent || null,
              className: flyout.className });
          }
        }
      }
    });
    window.__seerrFlyoutObserver.observe(document, { childList: true, subtree: true });
  });
  while (Date.now() < deadline) {
    const candidate = await page.locator('.seerr-flyout').elementHandle().catch(() => null);
    if (!candidate) { await page.waitForTimeout(100); continue; }
    const candidateId = await candidate.evaluate(node => {
      let id = window.__seerrFlyoutIds.get(node);
      if (!id) { id = ++window.__seerrNextFlyoutId; window.__seerrFlyoutIds.set(node, id); }
      return id;
    }).catch(() => null);
    if (previousPanelId !== null && candidateId !== null && candidateId !== previousPanelId) replacedPanels++;
    if (candidateId !== null) previousPanelId = candidateId;
    // BaseIntegration retries dynamic title extraction after two seconds.
    // Wait past that window and ensure the same panel still owns this title.
    const settleUntil = Date.now() + 2200;
    while (Date.now() < settleUntil) { urls.add(page.url()); await page.waitForTimeout(100); }
    const state = await candidate.evaluate(node => ({ connected: node.isConnected,
      title: node.querySelector('.seerr-title')?.textContent?.trim() || null })).catch(() => null);
    if (state?.connected && state.title === expectedTitle) {
      result.urlsWhileSettling = [...urls];
      result.flyoutReplacementsWhileSettling = await page.evaluate(() => {
        window.__seerrFlyoutObserver?.disconnect();
        return window.__seerrFlyoutEvents || [];
      });
      result.replacedPanelsWhileSettling = replacedPanels;
      return;
    }
    replacedPanels++;
  }
  result.urlsWhileSettling = [...urls];
  result.flyoutReplacementsWhileSettling = await page.evaluate(() => {
    window.__seerrFlyoutObserver?.disconnect();
    return window.__seerrFlyoutEvents || [];
  });
  result.replacedPanelsWhileSettling = replacedPanels;
  throw new Error(`Flyout for ${expectedTitle} did not stabilize after ${replacedPanels} panel replacements`);
}

(async () => {
  const build = await createExtension('chrome');
  let context;
  const results = [];
  try {
    context = await chromium.launchPersistentContext(path.join(build.temporary, 'profile'), {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${build.extension}`, `--load-extension=${build.extension}`]
    });
    // Contract fixtures can use fictional metadata to exercise parser edges.
    // Those expectations are not claims about the real URL's title.
    const cases = [...SITES.filter(site => site.live !== false), {
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
          if (site.expect.year) await expect(page.locator('.seerr-year')).toContainText(String(site.expect.year));
          result.extractedTitle = await page.locator('.seerr-title').textContent();
          result.extractedYear = await page.locator('.seerr-year').textContent();
          if (site.site === 'trakt') {
            await waitForStableFlyout(page, result.expectedTitle, result);
            await expect(page.locator('.seerr-title')).toHaveText(result.expectedTitle);
          }
          await verifySmallViewportFlyout(page, result);
          result.outcome = 'pass';
        }
      } catch (error) {
        result.outcome = stage === 'navigation' ? 'site-unavailable' : 'failed'; result.error = error.message.split('\n').slice(0, 12).join('\n');
      }
      if (result.outcome === 'failed' && /onetrust-consent-sdk.*intercepts pointer events/.test(result.error || '')) {
        result.outcome = 'blocked'; result.reason = 'Host consent dialog requires a privacy choice';
        result.consentControls = await page.locator('#onetrust-consent-sdk button').allTextContents();
      }
      result.pageTitle = await page.title().catch(() => null);
      if (result.outcome === 'failed' && /^(just a moment|access denied|attention required|verify you are human)/i.test(result.pageTitle || '')) {
        result.outcome = 'blocked'; result.reason = 'Access challenge';
      }
      result.extractedTitle ??= await page.locator('.seerr-title').textContent({ timeout: 500 }).catch(() => null);
      result.extractedYear ??= await page.locator('.seerr-year').textContent({ timeout: 500 }).catch(() => null);
      // Some Trakt redirects leave the expected page and injected panel ready
      // even though Chromium never observes DOMContentLoaded before timeout.
      // Retry the actual title and layout assertions before calling that site
      // unavailable; retain the timeout as a warning in the evidence report.
      if (result.outcome === 'site-unavailable'
        && /Timeout .*exceeded/i.test(result.error || '')
        && result.extractedTitle === result.expectedTitle
        && await page.locator('.seerr-flyout').count()) {
        result.navigationWarning = 'Navigation timed out after the expected page title became available.';
        result.finalUrl = page.url();
        try {
          await verifySmallViewportFlyout(page, result);
          result.outcome = 'pass';
          delete result.error;
        } catch (error) {
          result.outcome = 'failed';
          result.error = `Page content recovered after navigation timeout, but the flyout check failed: ${error.message.split('\n')[0]}`;
        }
      }
      if (result.outcome === 'failed' && await page.locator('.seerr-flyout').count()) {
        result.flyoutDebug = await page.evaluate(() => {
          const describe = element => {
            if (!element) return null;
            const bounds = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
              className: element.className,
              ariaExpanded: element.getAttribute('aria-expanded'),
              bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
              transform: style.transform,
              position: style.position
            };
          };
          const flyout = document.querySelector('.seerr-flyout');
          const tab = flyout?.querySelector('.seerr-tab');
          const tabBounds = tab?.getBoundingClientRect();
          const hit = tabBounds && document.elementFromPoint(tabBounds.x + tabBounds.width / 2, tabBounds.y + tabBounds.height / 2);
          return {
            viewport: { width: innerWidth, height: innerHeight },
            flyout: describe(flyout), panel: describe(flyout?.querySelector('.seerr-panel')),
            tab: describe(tab), tabHit: hit ? `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ''}.${String(hit.className || '').split(/\s+/).join('.')}` : null,
            flyoutCount: document.querySelectorAll('.seerr-flyout').length
          };
        });
      }
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

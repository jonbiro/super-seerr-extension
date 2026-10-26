const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { loadIntegration } = require('../helpers/integration');
const { SITES } = require('./site-fixtures.cjs');

// Measure the rendered label against its gradient and composited ancestors.
function textContrast(node) {
  const rgb = text => text.match(/[\d.]+/g).map(Number);
  const blend = (fg, bg) => fg.slice(0, 3).map((value, i) => value * (fg[3] ?? 1) + bg[i] * (1 - (fg[3] ?? 1)));
  const background = node => {
    if (!node) return [[255, 255, 255]];
    const style = getComputedStyle(node), base = background(node.parentElement);
    const stops = [...style.backgroundImage.matchAll(/rgba?\(([^)]+)\)/g)].map(match => rgb(match[1]));
    if (stops.length) {
      const [first, last] = [stops[0], stops.at(-1)];
      return Array.from({ length: 11 }, (_, i) => first.slice(0, 3).map((value, c) => value + (last[c] - value) * i / 10));
    }
    return base.map(color => blend(rgb(style.backgroundColor), color));
  };
  const luminance = color => color.slice(0, 3).map(value => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
  const foreground = rgb(getComputedStyle(node).color);
  return Math.min(...background(node).map(bg => {
    const a = luminance(blend(foreground, bg)), b = luminance(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }));
}

for (const theme of ['light', 'dark']) test(`flyout action labels remain legible in every provider theme on a ${theme} page`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 640, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setContent(`<body style="background:${theme === 'dark' ? '#161b22' : '#ffffff'}"></body>`);
  await page.addScriptTag({ path: path.resolve('src/shared/UIComponents.js') });
  const ratios = [];
  for (const site of [...new Set(SITES.map(item => item.site))]) {
    const fixture = loadIntegration({ site, url: SITES.find(item => item.site === site).url });
    const css = fixture.integration().getSiteSpecificCSS();
    fixture.dom.window.close();
    await page.evaluate(({ site, css }) => {
      document.querySelectorAll('.seerr-flyout, style').forEach(node => node.remove());
      const ui = new UIComponents({ siteName: site }); ui.injectStyles(css);
      const { flyout, panel } = ui.createFlyout();
      const controls = ui.createFlyoutContent({ title: 'Example movie', mediaType: 'movie' }, panel);
      ui.updateFlyoutStatus(controls, { status: 'available', message: 'Ready to request', buttonClass: 'request', buttonText: 'Request title' }, { plexConfigured: true });
      document.body.append(flyout); flyout.setExpanded(true);
      window.contrastUI = ui; window.contrastControls = controls;
    }, { site, css });
    await page.addStyleTag({ content: '.seerr-flyout * { transition: none !important; }' });
    for (const selector of ['.seerr-tab-text', '.seerr-action-button span', '.seerr-watchlist-button span', '.seerr-plex-button span']) {
      for (const hover of [false, true]) {
        if (hover) await page.locator(selector).hover();
        else await page.mouse.move(0, 0);
        const ratio = await page.locator(selector).evaluate(textContrast);
        ratios.push({ site, selector, hover, ratio: Number(ratio.toFixed(2)) });
      }
    }
    if (['simkl', 'tmdb', 'letterboxd'].includes(site)) {
      await page.mouse.move(0, 0);
      await page.locator('.seerr-flyout').screenshot({ path: testInfo.outputPath(`${site}-${theme}.png`) });
    }
    await page.evaluate(() => {
      contrastUI.updateFlyoutStatus(contrastControls, { status: 'available_watch', message: 'Available to watch', buttonClass: 'watch', buttonText: 'Watch title' }, { plexConfigured: true });
      contrastUI.showInLibraryBadge(document.querySelector('.seerr-media-info'));
    });
    for (const selector of ['.seerr-action-button span', '.seerr-in-library-badge']) {
      for (const hover of [false, true]) {
        if (hover) await page.locator(selector).hover();
        else await page.mouse.move(0, 0);
        ratios.push({ site, selector, status: 'watch', hover, ratio: await page.locator(selector).evaluate(textContrast) });
      }
    }
  }
  expect(ratios.filter(value => value.ratio < 4.5)).toEqual([]);
});

const { test, expect } = require('@playwright/test');
const path = require('node:path');

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 320 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setContent('<form id="host-form"></form>');
  await page.addScriptTag({ path: path.resolve('src/shared/NotificationCenter.js') });
  await page.addScriptTag({ path: path.resolve('src/shared/UIComponents.js') });
});

test('flyout and notifications fit a small window with long titles', async ({ page }) => {
  await page.evaluate(() => {
    document.body.style.backgroundColor = '#161b22';
    const ui = new UIComponents({ siteName: 'Layout' }); ui.injectStyles();
    const { flyout, panel } = ui.createFlyout();
    const elements = ui.createFlyoutContent({ title: 'LongTitle'.repeat(30), year: 2026, mediaType: 'tv' }, panel);
    ui.updateFlyoutStatus(elements, { status: 'available', buttonClass: 'request' });
    document.body.appendChild(flyout); flyout.setExpanded(true);
  });
  const panel = page.locator('.seerr-panel');
  await expect(panel).toBeFocused();
  await expect(page.locator('.seerr-panel-close')).toHaveCSS('color', 'rgb(249, 250, 251)');
  await expect(page.locator('.seerr-flyout')).toHaveCSS('transition-duration', '0s');
  const bounds = await panel.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(320);
  expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.getByRole('button', { name: 'Choose TV seasons' }).focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open Super Seerr', exact: true })).toBeFocused();
  await page.evaluate(() => new UIComponents().createNotification('Long notice', 'Message'.repeat(80), 'info', 0));
  const note = page.locator('.seerr-notification');
  await expect(note).toBeVisible();
  // Wait for the entrance animation before measuring its final position.
  await note.evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished)));
  const toast = await note.boundingBox();
  expect(toast.x).toBeGreaterThanOrEqual(0); expect(toast.y).toBeGreaterThanOrEqual(0);
  expect(toast.x + toast.width).toBeLessThanOrEqual(320);
  expect(toast.y + toast.height).toBeLessThanOrEqual(320);
  expect(await note.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
});

test('a replacement TV flyout stays on-screen after closing a movie flyout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await page.evaluate(() => {
    const ui = new UIComponents({ siteName: 'Trakt' }); ui.injectStyles();
    const { flyout, panel } = ui.createFlyout();
    ui.createFlyoutContent({ title: 'Fight Club', year: 1999, mediaType: 'movie' }, panel);
    document.body.appendChild(flyout);
  });
  await page.getByRole('button', { name: 'Open Super Seerr' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open Super Seerr' })).toHaveAttribute('aria-expanded', 'false');

  // Trakt uses same-tab route changes. Recreate the flyout just as its
  // integration does after navigation from a movie to a TV detail page.
  await page.evaluate(() => {
    document.querySelector('#seerr-flyout-trakt')?.remove();
    const ui = new UIComponents({ siteName: 'Trakt' }); ui.injectStyles();
    const { flyout, panel } = ui.createFlyout();
    ui.createFlyoutContent({ title: 'Breaking Bad', mediaType: 'tv' }, panel);
    document.body.appendChild(flyout);
  });
  await page.getByRole('button', { name: 'Open Super Seerr' }).click();
  await expect(page.locator('.seerr-title')).toHaveText('Breaking Bad');
  const bounds = await page.locator('.seerr-panel').boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(600);
});

test('injected request buttons never submit a host page form', async ({ page }) => {
  await page.evaluate(() => {
    window.submitted = 0;
    const form = document.getElementById('host-form');
    form.addEventListener('submit', event => { event.preventDefault(); window.submitted++; });
    form.appendChild(new UIComponents().createRequestButton());
  });
  await page.getByRole('button', { name: 'Request on Seerr' }).click();
  expect(await page.evaluate(() => window.submitted)).toBe(0);
});

test('notification timers pause for hover and focus; errors wait for dismissal', async ({ page }) => {
  await page.clock.install();
  await page.evaluate(() => {
    new UIComponents().injectStyles();
    new UIComponents().createNotification('Read this', 'Enough time to read', 'info', 5000);
  });
  await page.clock.runFor(10);
  const note = page.locator('.seerr-notification');
  await note.hover();
  await page.clock.runFor(6000);
  await expect(note).toBeVisible();
  await note.getByRole('button', { name: 'Dismiss notification' }).focus();
  await page.mouse.move(0, 0);
  await page.clock.runFor(6000);
  await expect(note).toBeVisible();
  await page.evaluate(() => document.activeElement.blur());
  await page.clock.runFor(5100);
  await expect(note).toHaveCount(0);
  await page.evaluate(() => new UIComponents().createNotification('Request failed', 'Check your connection and retry.', 'error'));
  await page.clock.runFor(60000);
  await expect(page.getByRole('alert')).toContainText('Request failed');
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
  await expect(note).toHaveCount(0);
});

test('notifications establish an empty live region before updating its text', async ({ page }) => {
  const initial = await page.evaluate(() => {
    const note = new UIComponents().createNotification('Saved', 'Your changes are saved.', 'info', 0);
    return { connected: note.isConnected, role: note.getAttribute('role'), text: note.textContent, atomic: note.getAttribute('aria-atomic') };
  });
  expect(initial).toEqual({ connected: true, role: 'status', text: '', atomic: 'true' });
  await expect(page.getByRole('status')).toContainText('Your changes are saved.');
});


test('TV season action follows status recovery and hides during writes', async ({ page }) => {
  await page.evaluate(() => {
    window.seasonUI = new UIComponents(); seasonUI.injectStyles();
    const { flyout, panel } = seasonUI.createFlyout();
    window.seasonElements = seasonUI.createFlyoutContent({ title: 'Series', mediaType: 'tv' }, panel);
    document.body.appendChild(flyout); flyout.setExpanded(true);
  });
  const action = page.locator('.seerr-seasons-button');
  await expect(action).toBeHidden(); await expect(action).toBeDisabled();
  for (const state of [
    { status: 'available' }, { status: 'loading', disabled: true },
    { status: 'error', action: 'retryStatus' }, { status: 'unmatched', action: 'choose' },
    { status: 'blocklisted', disabled: true }, { status: 'available_watch' }, { status: 'pending' }
  ]) {
    await page.evaluate(state => seasonUI.updateFlyoutStatus(seasonElements, state), state);
    if (['available', 'available_watch', 'pending'].includes(state.status)) {
      await expect(action).toBeVisible(); await expect(action).toBeEnabled();
    } else {
      await expect(action).toBeHidden(); await expect(action).toBeDisabled();
    }
  }
});

for (const [name, details, primary, context] of [
  ['declined', { status: 3, media: { tmdbId: 1, inProduction: true } }, 'Request declined', 'Series in production'],
  ['failed', { status: 4, media: { tmdbId: 1, inProduction: true } }, 'Request failed', 'Series in production'],
  ['processing', { mediaInfo: { status: 3, seasons: [{ status: 5 }, { status: 3 }] } }, 'Processing download', '1 season not fully available']
]) test(`title context never hides the ${name} request status`, async ({ page }) => {
  const { loadWorker } = require('../helpers/worker');
  const { api } = loadWorker();
  const status = api.formatMediaStatus(details, 'tv');
  await page.evaluate(status => {
    const ui = new UIComponents(); ui.injectStyles();
    const { flyout, panel } = ui.createFlyout();
    const elements = ui.createFlyoutContent({ title: 'Example series', mediaType: 'tv' }, panel);
    ui.updateFlyoutStatus(elements, status);
    document.body.append(flyout); flyout.setExpanded(true);
  }, status);
  const text = page.locator('.seerr-status-text');
  await expect(text).toContainText(primary);
  await expect(text).toContainText(context);
  await expect(text).not.toContainText('Monitoring');
  expect(await page.locator('.seerr-panel').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  if (name === 'declined') await page.locator('.seerr-panel').screenshot({ path: '/tmp/super-seerr-3.5.159-status-context.png' });
});

test('processing status stays readable across malformed and nested progress updates', async ({ page }) => {
  const { loadWorker } = require('../helpers/worker');
  const { api } = loadWorker();
  await page.evaluate(() => {
    window.progressUI = new UIComponents(); progressUI.injectStyles();
    const { flyout, panel } = progressUI.createFlyout();
    window.progressElements = progressUI.createFlyoutContent({ title: 'Example movie', mediaType: 'movie' }, panel);
    document.body.append(flyout); flyout.setExpanded(true);
  });
  for (const [details, label] of [
    [{ mediaInfo: { status: 3 }, progress: {} }, 'Processing...'],
    [{ mediaInfo: { status: 3, percentage: '42%' } }, 'Downloading 42%'],
    [{ mediaInfo: { status: 3, percentage: 101 } }, 'Processing...']
  ]) {
    const status = api.formatMediaStatus(details, 'movie');
    await page.evaluate(status => progressUI.updateFlyoutStatus(progressElements, status), status);
    await expect(page.locator('.seerr-action-button span')).toHaveText(label);
    await expect(page.locator('.seerr-status-text')).not.toContainText('[object Object]');
    await expect(page.locator('.seerr-status-text')).not.toContainText('%%');
    expect(await page.locator('.seerr-panel').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  }
});

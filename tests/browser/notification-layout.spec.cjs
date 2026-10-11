const { test, expect } = require('@playwright/test');
const path = require('node:path');

async function install(page) {
  await page.setContent('<button id="origin">Add to Plex Watchlist</button>');
  await page.addStyleTag({ path: path.resolve('src/content/seerr-overlay.css') });
  await page.addScriptTag({ path: path.resolve('src/shared/NotificationCenter.js') });
  await page.locator('#origin').focus();
}

for (const width of [320, 375]) test(`Seerr error notifications wrap long text within a ${width}px screen`, async ({ page }) => {
  await page.setViewportSize({ width, height: 500 });
  await install(page);
  await page.evaluate(() => SeerrNotifications.createNotification('Plex Watchlist Failed', 'Connection failed: ' + 'long-server-name'.repeat(12), 'error'));
  const note = page.getByRole('alert');
  await expect(note).toContainText('Connection failed');
  const bounds = await note.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
  await page.screenshot({ path: `/tmp/super-seerr-3.5.180-notification-${width}.png` });
  const message = note.locator('.seerr-notification-message');
  expect(await message.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await note.getByRole('button', { name: 'Dismiss notification' }).focus();
  await page.keyboard.press('Enter');
  await expect(note).toHaveCount(0);
  await expect(page.locator('#origin')).toBeFocused();
});

test('a Seerr notification stack keeps every keyboard dismiss control within a short screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 220 });
  await install(page);
  await page.evaluate(() => {
    for (let i = 1; i <= 4; i++) SeerrNotifications.createNotification(`Failure ${i}`, 'The server could not complete this request. Please review your connection settings.', 'error');
  });
  const buttons = page.getByRole('button', { name: 'Dismiss notification' });
  await expect(buttons).toHaveCount(4);
  for (let i = 0; i < 4; i++) {
    await buttons.nth(i).focus();
    const bounds = await buttons.nth(i).boundingBox();
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(220);
  }
  await buttons.last().hover();
  await page.mouse.wheel(0, 500);
  const stack = page.locator('.seerr-notification-stack');
  await expect.poll(() => stack.evaluate(node => Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop))).toBeLessThanOrEqual(1);
  await page.screenshot({ path: '/tmp/super-seerr-3.5.180-notification-stack.png' });
});

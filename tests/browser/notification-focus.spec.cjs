const { test, expect } = require('@playwright/test');
const path = require('node:path');

async function install(page) {
  await page.setContent('<button id="origin">Request title</button><button id="other">Other action</button>');
  await page.addScriptTag({ path: path.resolve('src/shared/NotificationCenter.js') });
  await page.locator('#origin').focus();
  await page.evaluate(() => {
    window.note = SeerrNotifications.createNotification('Request complete', 'Family server', 'success', 0);
  });
  await expect(page.getByRole('button', { name: 'Dismiss notification' })).toBeVisible();
}

for (const reducedMotion of ['reduce', 'no-preference']) {
  test(`dismissing a focused notification restores its initiating control (${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await install(page);
    await page.getByRole('button', { name: 'Dismiss notification' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#origin')).toBeFocused();
    await expect(page.getByRole('button', { name: 'Dismiss notification' })).toHaveCount(0);
  });
}

test('dismissal moves focus to another notification when the initiating control was removed', async ({ page }) => {
  await install(page);
  await page.evaluate(() => {
    document.querySelector('#origin').remove();
    SeerrNotifications.createNotification('Second request', 'Other server', 'success', 0);
  });
  const buttons = page.getByRole('button', { name: 'Dismiss notification' });
  await expect(buttons).toHaveCount(2);
  await buttons.first().focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Dismiss notification' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Dismiss notification' })).toBeFocused();
});

test('background removal preserves focus on an unrelated control', async ({ page }) => {
  await install(page);
  await page.locator('#other').focus();
  await page.evaluate(() => SeerrNotifications.removeNotification(window.note));
  await expect(page.locator('#other')).toBeFocused();
});

test('notification keys cannot trigger host shortcuts or block native dismissal', async ({ page }) => {
  await install(page);
  await page.evaluate(() => {
    window.hostKeys = [];
    document.addEventListener('keydown', event => { hostKeys.push(event.key); event.preventDefault(); });
  });
  await page.getByRole('button', { name: 'Dismiss notification' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Dismiss notification' })).toHaveCount(0);
  expect(await page.evaluate(() => hostKeys)).toEqual([]);
});

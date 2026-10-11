const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

for (const trigger of ['manual', 'site change', 'focused repair']) for (const success of [true, false]) {
  test(`popup replaces obsolete diagnostics while checking (${trigger}, success: ${success})`, async ({ page }) => {
    const html = fs.readFileSync('src/popup/popup.html', 'utf8')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, '');
    await page.setContent(html);
    await page.addStyleTag({ path: path.resolve('src/popup/popup.css') });
    await page.evaluate(({ trigger }) => {
      const report = serverUrl => ({ serverUrl, apiKeyConfigured: true, checks: {
        permission: { state: 'ok', message: 'Host access granted' },
        apiKey: { state: 'ok', message: 'API key accepted' },
        seerr: { state: 'ok', message: 'Seerr is reachable' },
        plex: { state: 'ok', message: 'Plex connected' }
      } });
      let reads = 0;
      window.chrome = { runtime: {
        onMessage: { addListener(listener) { window.notifyDiagnostics = listener; } },
        sendMessage() {
          if (++reads === 1) {
            const data = report('https://home.example/');
            if (trigger === 'focused repair') data.checks.apiKey = { state: 'error', message: 'Old key rejected', fix: 'apiKey' };
            return Promise.resolve({ success: true, data });
          }
          return new Promise(resolve => { window.finishDiagnostics = success => resolve(success
            ? { success: true, data: report('https://family.example/') } : { success: false }); });
        }
      } };
    }, { trigger });
    await page.addScriptTag({ path: path.resolve('src/popup/popup.js') });
    await expect(page.locator('#serverUrl')).toHaveText('home.example');
    if (trigger === 'manual') await page.locator('#testConnection').click();
    else {
      if (trigger === 'focused repair') await page.getByRole('button', { name: 'Fix api key' }).focus();
      await page.evaluate(() => notifyDiagnostics({ action: 'seerrConfigChanged' }));
    }
    await expect(page.locator('#statusIndicator')).toContainText('Checking connections');
    await expect(page.locator('#configuredState')).toBeHidden();
    await expect(page.locator('#notConfiguredState')).toBeHidden();
    await expect(page.locator('#errorState')).toBeHidden();
    await expect(page.locator('#diagnosticChecks .diagnostic-row')).toHaveCount(0);
    await expect(page.locator('#diagnosticChecks')).toHaveAttribute('aria-busy', 'true');
    if (trigger === 'focused repair') await expect(page.locator('#testConnection')).toBeFocused();
    await page.evaluate(success => finishDiagnostics(success), success);
    await expect(page.locator('#diagnosticChecks')).not.toHaveAttribute('aria-busy', 'true');
    if (success) {
      await expect(page.locator('#configuredState')).toBeVisible();
      await expect(page.locator('#serverUrl')).toHaveText('family.example');
      await expect(page.locator('#configuredHeading')).toHaveText('Ready to request');
    } else {
      await expect(page.locator('#configuredState')).toBeHidden();
      await expect(page.locator('#errorState')).toBeVisible();
    }
    await expect(page.locator('#testConnection')).toBeEnabled();
  });
}

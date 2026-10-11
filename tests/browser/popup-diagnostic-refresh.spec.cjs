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
    await expect(page.locator('#testConnection')).toBeDisabled();
    await expect(page.locator('#testConnection')).toContainText('Checking…');
    if (trigger === 'focused repair') await expect(page.locator('#openOptions')).toBeFocused();
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

for (const firstSuccess of [true, false]) for (const newestFirst of [true, false]) {
  test(`popup keeps diagnostic controls owned by latest check (old success: ${firstSuccess}, newest first: ${newestFirst})`, async ({ page }) => {
    const html = fs.readFileSync('src/popup/popup.html', 'utf8')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, '');
    await page.setContent(html);
    await page.addStyleTag({ path: path.resolve('src/popup/popup.css') });
    await page.evaluate(() => {
      window.diagnosticReplies = [];
      window.diagnosticReads = 0;
      window.reportDiagnostics = serverUrl => ({ success: true, data: { serverUrl, apiKeyConfigured: true, checks:
        Object.fromEntries(['seerr', 'permission', 'apiKey', 'plex'].map(key => [key, { state: 'ok', message: 'Connected' }]))
      } });
      window.chrome = { runtime: {
        onMessage: { addListener(listener) { window.notifyDiagnostics = listener; } },
        sendMessage() {
          if (++window.diagnosticReads === 1) return Promise.resolve(reportDiagnostics('https://home.example/'));
          return new Promise(resolve => window.diagnosticReplies.push(resolve));
        }
      } };
    });
    await page.addScriptTag({ path: path.resolve('src/popup/popup.js') });
    await expect(page.locator('#serverUrl')).toHaveText('home.example');
    await page.locator('#testConnection').click();
    await page.evaluate(() => notifyDiagnostics({ action: 'seerrConfigChanged' }));
    const finishOld = () => page.evaluate(success => diagnosticReplies[0](success
      ? reportDiagnostics('https://home.example/') : { success: false }), firstSuccess);
    const finishNewest = () => page.evaluate(() => diagnosticReplies[1](reportDiagnostics('https://family.example/')));
    if (newestFirst) {
      await finishNewest();
      await expect(page.locator('#testConnection')).toBeEnabled();
      await expect(page.locator('#testConnection')).toContainText('Check connections');
      await finishOld();
    } else {
      await finishOld();
      await expect(page.locator('#diagnosticChecks')).toHaveAttribute('aria-busy', 'true');
      await expect(page.locator('#testConnection')).toBeDisabled();
      await expect(page.locator('#testConnection')).toContainText('Checking…');
      await page.locator('#testConnection').evaluate(button => button.click());
      expect(await page.evaluate(() => diagnosticReads)).toBe(3);
      await finishNewest();
    }
    await expect(page.locator('#testConnection')).toBeEnabled();
    await expect(page.locator('#testConnection')).toContainText('Check connections');
    await expect(page.locator('#serverUrl')).toHaveText('family.example');
    await expect(page.locator('#statusIndicator')).toContainText('Ready to request');
    await expect(page.locator('#diagnosticChecks')).not.toHaveAttribute('aria-busy', 'true');
  });
}

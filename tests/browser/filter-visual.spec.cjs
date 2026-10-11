const { test, expect } = require('@playwright/test');
const path = require('node:path');

async function showFilter(page, width) {
  await page.setViewportSize({ width, height: 960 });
  await page.route('https://seerr.example/**', route => route.request().isNavigationRequest()
    ? route.fulfill({ contentType: 'text/html', body: `<style>body{margin:0;background:#0f172a;color:#e2e8f0;font:14px system-ui}main{max-width:1160px;margin:auto;padding:24px}h1{font-size:28px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:16px}article{background:#1e293b;border-radius:12px;min-height:120px;padding:16px}a{color:inherit}</style><main><h1>Discover</h1><div class="grid"><article data-testid="title-card"><a href="/movie/920"><h2>Example</h2></a></article></div></main>
      <script type="application/json">{"props":{"results":[{"id":920,"mediaType":"movie","title":"Example","rtCriticsScore":80,"rtAudienceScore":90,"imdbRating":8,"voteAverage":8}]}}</script>` })
    : route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.goto('https://seerr.example/discover');
  await page.evaluate(() => {
    window.chrome = { storage: { sync: { get: async () => ({ seerrUrl: 'https://seerr.example' }) }, onChanged: { addListener() {}, removeListener() {} } },
      runtime: { onMessage: { addListener() {} }, sendMessage: async message => {
        if (message.action === 'getConfigState') return { success: true, data: { serverUrl: 'https://seerr.example', apiConfigured: true } };
        if (message.action === 'saveFilterPreset') { window.savedPreset = message.data; return { success: true, data: [message.data] }; }
        if (message.action === 'getFilterPresets') return { success: true, data: [{ name: 'Movie night', sort: 'default', filters: {} }] };
        return { success: true, data: {} };
      } } };
  });
  await page.addStyleTag({ path: path.resolve('src/content/seerr-overlay.css') });
  for (const file of ['shared/RatingsConfig', 'shared/RatingsModel', 'shared/NotificationCenter', 'shared/SeasonPicker',
    'content/OverlayCache', 'content/RatingsPresentation', 'content/SeerrSession', 'content/FilterPresets', 'content/RatingQueue', 'content/seerr-integration']) {
    await page.addScriptTag({ path: path.resolve(`src/${file}.js`) });
  }
  await expect(page.locator('#seerr-filter-bar')).toBeVisible();
  await expect(page.getByLabel('Saved filter presets')).toBeEnabled();
}

for (const width of [1440, 1280, 1024, 768, 600, 390, 320]) test(`filter layout and controls remain usable at ${width}px`, async ({ page }) => {
  await showFilter(page, width);
  if (process.env.FILTER_PREVIEW) await page.locator('#seerr-filter-bar').screenshot({ path: `/tmp/super-seerr-filter-${process.env.FILTER_PREVIEW}-${width}.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const critics = page.getByLabel('Critics ≥', { exact: true });
  if (width >= 1024) {
    const sortBounds = await page.getByLabel('Sort titles', { exact: true }).boundingBox();
    const scoreBounds = await critics.boundingBox();
    expect(Math.abs(sortBounds.y + sortBounds.height - scoreBounds.y - scoreBounds.height)).toBeLessThanOrEqual(1);
    expect((await page.getByLabel('Saved filter presets').boundingBox()).width).toBeLessThanOrEqual(280);
  }
  if (width <= 390) {
    const presetBounds = await page.getByLabel('Saved filter presets').boundingBox();
    const nameBounds = await page.getByLabel('Preset name').boundingBox();
    expect(Math.abs(presetBounds.width - nameBounds.width)).toBeLessThanOrEqual(1);
  }
  await critics.fill('85'); await critics.dispatchEvent('input');
  await expect(critics.locator('..')).toHaveClass(/is-active/);
  await expect(page.locator('[data-testid="title-card"]')).toBeHidden();
  await expect(page.locator('.seerr-score-coverage')).toContainText('0 visible');
  await page.getByRole('button', { name: 'Hide filters', exact: true }).click();
  await expect(page.locator('#seerr-filter-bar')).toBeHidden();
  const toggle = page.locator('#seerr-filter-toggle');
  await expect(toggle).toHaveText('Sort & filter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(critics).toHaveValue('85');
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(critics).toHaveValue('0');
  await expect(page.locator('[data-testid="title-card"]')).toBeVisible();
  await page.getByLabel('Sort titles', { exact: true }).selectOption('rt-critics-desc');
  expect(await page.locator('#seerr-filter-bar').evaluate(bar => {
    const panel = bar.getBoundingClientRect();
    return [...bar.querySelectorAll('input, select, button')].every(control => {
      if (!control.getClientRects().length) return true;
      const bounds = control.getBoundingClientRect();
      return bounds.left >= panel.left && bounds.right <= panel.right;
    });
  })).toBe(true);
});

for (const [label, key, max] of [['Critics ≥', 'minCritics', 100], ['Audience ≥', 'minAudience', 100], ['TMDB ≥', 'minTmdb', 10], ['IMDb ≥', 'minImdb', 10]]) {
  const high = key === 'minAudience' ? 90.5 : max === 100 ? 80.5 : 8.5;
  for (const [form, value, expected, visible] of [
    ['decimal', String(high), String(high), false],
    ['exponent', max === 100 ? `${high / 10}e1` : '8.5e-1', max === 100 ? `${high / 10}e1` : '8.5e-1', max !== 100],
    ['above maximum', '1000', String(max), false],
    ['negative', '-5', '0', true]
  ]) test(`typed ${label} threshold matches filtering and saved presets (${form})`, async ({ page }) => {
    await showFilter(page, 1280);
    const input = page.getByLabel(label, { exact: true });
    await input.fill(value);
    await input.dispatchEvent('input');
    await expect(input).toHaveValue(expected);
    await expect(page.locator('[data-testid="title-card"]')).toBeVisible({ visible });
    if (Number(expected) > 0) await expect(input.locator('..')).toHaveClass(/is-active/);
    else await expect(input.locator('..')).not.toHaveClass(/is-active/);
    await page.getByLabel('Preset name').fill('Threshold');
    await page.getByRole('button', { name: 'Save preset', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Saved Threshold');
    expect(await page.evaluate(key => window.savedPreset.filters[key], key)).toBe(Number(expected));
  });
}

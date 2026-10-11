const { test, expect } = require('@playwright/test');
const path = require('node:path');

async function showFilter(page, width, { apiConfigured = true } = {}) {
  await page.setViewportSize({ width, height: 960 });
  await page.route('https://seerr.example/**', route => route.request().isNavigationRequest()
    ? route.fulfill({ contentType: 'text/html', body: `<style>body{margin:0;background:#0f172a;color:#e2e8f0;font:14px system-ui}main{max-width:1160px;margin:auto;padding:24px}h1{font-size:28px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:16px}article{background:#1e293b;border-radius:12px;min-height:120px;padding:16px}a{color:inherit}</style><main><h1>Discover</h1><div class="grid"><article data-testid="title-card"><a href="/movie/920"><h2>Example</h2></a></article></div></main>
      <script type="application/json">{"props":{"results":[{"id":920,"mediaType":"movie","title":"Example","rtCriticsScore":80,"rtAudienceScore":90,"imdbRating":8,"voteAverage":8}]}}</script>` })
    : route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.goto('https://seerr.example/discover');
  await page.evaluate(apiConfigured => {
    window.filterStorageListeners = [];
    window.chrome = { storage: { sync: { get: async () => ({ seerrUrl: 'https://seerr.example' }) }, onChanged: { addListener(listener) { filterStorageListeners.push(listener); }, removeListener() {} } },
      runtime: { onMessage: { addListener() {} }, sendMessage: async message => {
        if (message.action === 'getConfigState') return { success: true, data: { serverUrl: 'https://seerr.example', apiConfigured } };
        if (message.action === 'saveFilterPreset') { window.savedPreset = message.data; return { success: true, data: [message.data] }; }
        if (message.action === 'getFilterPresets') return { success: true, data: window.presetEntries || [{ name: 'Movie night', sort: 'default', filters: { minCritics: 85 } }] };
        return { success: true, data: {} };
      } } };
  }, apiConfigured);
  await page.addStyleTag({ path: path.resolve('src/content/seerr-overlay.css') });
  for (const file of ['shared/RatingsConfig', 'shared/RatingsModel', 'shared/NotificationCenter', 'shared/SeasonPicker',
    'content/OverlayCache', 'content/RatingsPresentation', 'content/SeerrSession', 'content/FilterPresets', 'content/RatingQueue', 'content/seerr-integration']) {
    await page.addScriptTag({ path: path.resolve(`src/${file}.js`) });
  }
  await expect(page.locator('#seerr-filter-bar')).toBeVisible();
  await expect(page.getByLabel('Saved filter presets')).toBeEnabled();
}

function expectActionGrid({ resetBounds, refreshBounds, loadBounds, actionsBounds }) {
  const half = (actionsBounds.width - 8) / 2;
  expect(Math.abs(resetBounds.x - actionsBounds.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(resetBounds.width - half)).toBeLessThanOrEqual(1);
  expect(Math.abs(refreshBounds.width - half)).toBeLessThanOrEqual(1);
  expect(Math.abs(resetBounds.y - refreshBounds.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(refreshBounds.x - resetBounds.x - resetBounds.width - 8)).toBeLessThanOrEqual(1);
  expect(Math.abs(loadBounds.x - actionsBounds.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(loadBounds.y - refreshBounds.y - refreshBounds.height - 8)).toBeLessThanOrEqual(1);
}

for (const width of [1440, 1280, 1024, 768, 600, 390, 320]) test(`filter layout and controls remain usable at ${width}px`, async ({ page }) => {
  await showFilter(page, width);
  if (process.env.FILTER_PREVIEW) await page.locator('#seerr-filter-bar').screenshot({ path: `/tmp/super-seerr-filter-${process.env.FILTER_PREVIEW}-${width}.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const critics = page.getByLabel('Critics ≥', { exact: true });
  const sortBounds = await page.getByLabel('Sort titles', { exact: true }).boundingBox();
  const sortLabelBounds = await page.locator('label[for="seerr-sort-order"]').boundingBox();
  const criticsLabelBounds = await page.locator('label[for="seerr-min-critics"]').boundingBox();
  const presetBounds = await page.getByLabel('Saved filter presets').boundingBox();
  const nameBounds = await page.getByLabel('Preset name').boundingBox();
  const saveBounds = await page.getByRole('button', { name: 'Save preset', exact: true }).boundingBox();
  const deleteBounds = await page.getByRole('button', { name: 'Delete preset', exact: true }).boundingBox();
  // Preset actions stay together instead of leaving Delete on an orphan row.
  expect(Math.abs(saveBounds.y - deleteBounds.y)).toBeLessThanOrEqual(1);
  const panelBounds = await page.locator('#seerr-filter-bar').boundingBox();
  expect(Math.abs(sortBounds.x - panelBounds.x - 17)).toBeLessThanOrEqual(1);
  const hintBounds = await page.locator('.seerr-rating-filter-hint').boundingBox();
  const ratingHeadingBounds = await page.getByRole('heading', { name: 'Minimum ratings', exact: true }).boundingBox();
  const refreshBounds = await page.getByRole('button', { name: 'Refresh scores' }).boundingBox();
  const resetBounds = await page.getByRole('button', { name: 'Reset', exact: true }).boundingBox();
  expect(await page.locator('.seerr-rating-filter-hint').textContent()).toBe('0 means any score');
  expect(hintBounds.y).toBeLessThanOrEqual(ratingHeadingBounds.y + ratingHeadingBounds.height);
  if (width > 600) {
    // Reset stays with the refresh/load actions instead of floating under the sort field.
    expect(Math.abs(resetBounds.x - panelBounds.x - 17)).toBeLessThanOrEqual(1);
    expect(Math.abs(refreshBounds.x - resetBounds.x - resetBounds.width - 8)).toBeLessThanOrEqual(1);
  } else {
    // A two-column action grid: Reset | Refresh, then Load | Select, with
    // equal-width cells that share the panel's content edges.
    const loadBounds = await page.getByRole('button', { name: /Load 500 more/ }).boundingBox();
    const selectBounds = await page.getByRole('button', { name: 'Select titles', exact: true }).boundingBox();
    const actionsBounds = await page.locator('.seerr-filter-actions').boundingBox();
    expectActionGrid({ resetBounds, refreshBounds, loadBounds, actionsBounds });
    expect(Math.abs(selectBounds.y - loadBounds.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(selectBounds.x - loadBounds.x - loadBounds.width - 8)).toBeLessThanOrEqual(1);
    expect(Math.abs(selectBounds.x + selectBounds.width - actionsBounds.x - actionsBounds.width)).toBeLessThanOrEqual(1);
  }
  if (width >= 600 && width <= 768) {
    expect(Math.abs(presetBounds.y - nameBounds.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(presetBounds.width - nameBounds.width)).toBeLessThanOrEqual(1);
  }
  if (width >= 1024) {
    // Both control groups start on the same visual line; avoid the old blank
    // spacer above Sort titles, which made the wide layout feel lopsided.
    expect(Math.abs(sortLabelBounds.y - ratingHeadingBounds.y)).toBeLessThanOrEqual(1);
    const headingBounds = await page.locator('.seerr-presets-label').boundingBox();
    expect(presetBounds.x - headingBounds.x - headingBounds.width).toBeLessThanOrEqual(12);
    // The sort label starts alongside the ratings-group heading, and its
    // selector begins alongside the individual rating labels.
    expect(Math.abs(sortBounds.y - criticsLabelBounds.y)).toBeLessThanOrEqual(4);
    expect((await page.getByLabel('Saved filter presets').boundingBox()).width).toBeLessThanOrEqual(280);
  }
  if (width <= 390) {
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

for (const width of [600, 390, 320]) test(`narrow filter actions stay paired without Select titles at ${width}px`, async ({ page }) => {
  await showFilter(page, width, { apiConfigured: false });
  await expect(page.getByRole('button', { name: 'Select titles', exact: true })).toHaveCount(0);
  const resetBounds = await page.getByRole('button', { name: 'Reset', exact: true }).boundingBox();
  const refreshBounds = await page.getByRole('button', { name: 'Refresh scores' }).boundingBox();
  const loadBounds = await page.getByRole('button', { name: /Load 500 more/ }).boundingBox();
  const actionsBounds = await page.locator('.seerr-filter-actions').boundingBox();
  expectActionGrid({ resetBounds, refreshBounds, loadBounds, actionsBounds });
  // Load spans the final row rather than sitting as a half-width orphan.
  expect(Math.abs(loadBounds.width - actionsBounds.width)).toBeLessThanOrEqual(1);
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

for (const [label, next] of [['Critics ≥', 'Audience ≥'], ['Audience ≥', 'TMDB ≥'], ['TMDB ≥', 'IMDb ≥'], ['IMDb ≥', 'Reset']]) {
  test(`filter keyboard editing isolates host shortcuts (${label})`, async ({ page }) => {
    await showFilter(page, 1280);
    await page.evaluate(() => {
      const outside = document.createElement('button'); outside.id = 'outside'; outside.textContent = 'Other action'; document.body.append(outside);
      window.hostKeys = [];
      document.addEventListener('keydown', event => { hostKeys.push(event.key); event.preventDefault(); });
    });
    const input = page.getByLabel(label, { exact: true });
    await input.fill(''); await input.focus();
    await page.keyboard.press('5');
    await expect(input).toHaveValue('5');
    await page.keyboard.press('Tab');
    await expect(next === 'Reset' ? page.getByRole('button', { name: next, exact: true }) : page.getByLabel(next, { exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(input).toBeFocused();
    expect(await page.evaluate(() => hostKeys)).toEqual([]);
    await page.locator('#outside').focus(); await page.keyboard.press('h');
    expect(await page.evaluate(() => hostKeys)).toEqual(['h']);
  });
}

for (const label of ['Critics ≥', 'Audience ≥', 'TMDB ≥', 'IMDb ≥']) test(`Enter in ${label} does not submit a host search form`, async ({ page }) => {
  await showFilter(page, 1280);
  await page.evaluate(() => {
    const bar = document.querySelector('#seerr-filter-bar');
    const form = document.createElement('form'); bar.before(form); form.append(bar);
    const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = 'Host search'; form.append(submit);
    window.hostSubmits = 0;
    form.addEventListener('submit', event => { event.preventDefault(); hostSubmits++; });
  });
  const input = page.getByLabel(label, { exact: true });
  await input.fill('5'); await input.focus(); await page.keyboard.press('Enter');
  expect(await page.evaluate(() => hostSubmits)).toBe(0);
  await expect(input).toBeFocused();
  await page.getByRole('button', { name: 'Host search', exact: true }).click();
  expect(await page.evaluate(() => hostSubmits)).toBe(1);
});

test('keyboard filter actions and toggle work despite host shortcuts', async ({ page }) => {
  await showFilter(page, 1280);
  await page.getByLabel('Critics ≥', { exact: true }).fill('85');
  await page.evaluate(() => document.addEventListener('keydown', event => event.preventDefault()));
  await page.getByRole('button', { name: 'Reset', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Critics ≥', { exact: true })).toHaveValue('0');
  await page.locator('#seerr-filter-toggle').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#seerr-filter-bar')).toBeHidden();
  await page.keyboard.press('Space');
  await expect(page.locator('#seerr-filter-bar')).toBeVisible();
});

for (const change of ['critics', 'audience', 'tmdb', 'imdb', 'sort', 'reset']) {
  test(`editing ${change} clears an obsolete applied preset and permits reapplication`, async ({ page }) => {
    await showFilter(page, 1280);
    const presets = page.getByLabel('Saved filter presets');
    await presets.selectOption('Movie night');
    await expect(page.getByLabel('Critics ≥', { exact: true })).toHaveValue('85');
    if (change === 'reset') await page.getByRole('button', { name: 'Reset', exact: true }).click();
    else if (change === 'sort') await page.getByLabel('Sort titles', { exact: true }).selectOption('score-desc');
    else {
      await page.locator(`.seerr-min-${change}`).fill(change === 'critics' ? '70' : change === 'audience' ? '95' : '9');
    }
    await expect(presets).toHaveValue('');
    await expect(page.locator('.seerr-filter-presets [role="status"]')).toHaveText('');
    await expect(page.getByLabel('Preset name')).toHaveValue('Movie night');
    await expect(page.getByRole('button', { name: 'Delete preset', exact: true })).toBeDisabled();
    await presets.selectOption('Movie night');
    await expect(page.getByLabel('Critics ≥', { exact: true })).toHaveValue('85');
    for (const label of ['Audience ≥', 'TMDB ≥', 'IMDb ≥']) await expect(page.getByLabel(label, { exact: true })).toHaveValue('0');
    await expect(page.getByLabel('Sort titles', { exact: true })).toHaveValue('default');
    await expect(page.locator('[data-testid="title-card"]')).toBeHidden();
    await expect(presets).toHaveValue('Movie night');
  });
}

for (const changed of [true, false]) test(`cross-tab preset refresh reconciles the applied definition (changed: ${changed})`, async ({ page }) => {
  await showFilter(page, 1280);
  const presets = page.getByLabel('Saved filter presets');
  await presets.selectOption('Movie night');
  await page.evaluate(changed => {
    window.presetEntries = [{ name: 'Movie night', sort: 'default', filters: { minCritics: changed ? 70 : 85 } },
      { name: 'Other preset', sort: 'default', filters: {} }];
    filterStorageListeners.forEach(listener => listener({ seerrFilterPresetsV1: {} }, 'sync'));
  }, changed);
  await expect(presets.locator('option')).toHaveCount(3);
  await expect(presets).toHaveValue(changed ? '' : 'Movie night');
  await expect(page.getByLabel('Critics ≥', { exact: true })).toHaveValue('85');
  await expect(page.getByLabel('Preset name')).toHaveValue('Movie night');
  await expect(page.locator('[data-testid="title-card"]')).toBeHidden();
  if (changed) {
    await expect(page.locator('.seerr-filter-presets [role="status"]')).toHaveText('');
    await presets.selectOption('Movie night');
    await expect(page.getByLabel('Critics ≥', { exact: true })).toHaveValue('70');
    await expect(page.locator('[data-testid="title-card"]')).toBeVisible();
  } else await expect(page.getByRole('status')).toHaveText('Applied Movie night');
});

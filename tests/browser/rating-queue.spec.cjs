const { test, expect } = require('@playwright/test');
const path = require('node:path');

test('real layout prioritizes visible ratings over hidden wrappers and horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.setContent(`<style>.card { position:absolute; width:40px; height:40px; }</style>
    <div style="display:none"><div class="card" id="filtered"></div></div>
    <div class="card" id="horizontal" style="left:5000px;top:0"></div>
    <div class="card" id="below" style="left:0;top:600px"></div>
    <div class="card" id="visible" style="left:0;top:20px"></div>`);
  await page.addScriptTag({ path: path.resolve('src/content/RatingQueue.js') });
  await page.evaluate(() => {
    window.queue = window.createRatingQueue(1);
    window.starts = []; window.releases = [];
    window.jobs = ['filtered', 'horizontal', 'below', 'visible'].map(id => queue.add(document.getElementById(id), () => {
      starts.push(id);
      return new Promise(resolve => releases.push(resolve));
    }));
  });
  for (const expected of [
    ['visible'], ['visible', 'below'], ['visible', 'below', 'horizontal'], ['visible', 'below', 'horizontal', 'filtered']
  ]) {
    await expect.poll(() => page.evaluate(() => starts)).toEqual(expected);
    await page.evaluate(index => releases[index](), expected.length - 1);
  }
  await page.evaluate(() => Promise.all(jobs));
});

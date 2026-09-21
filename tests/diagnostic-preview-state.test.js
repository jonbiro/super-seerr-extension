const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
test('a failed diagnostic refresh cannot leave an obsolete report visible', async t => {
  const dom = new JSDOM('<main></main>', {runScripts:'outside-only'}); t.after(() => dom.window.close());
  const tick = () => new Promise(resolve => setImmediate(resolve));
  let count = 0, finish;
  dom.window.chrome = {runtime:{sendMessage:async () => {
    if (++count === 1) return {success:true,data:{version:'old'}};
    return new Promise(resolve => {finish = resolve;});
  }}};
  dom.window.eval(fs.readFileSync('src/options/support-tools.js','utf8'));
  const button = name => [...dom.window.document.querySelectorAll('button')].find(b => b.textContent === name);
  const prepare = button('Prepare diagnostic report');
  const preview = dom.window.document.querySelector('textarea');
  prepare.click(); await tick();
  assert.equal(preview.hidden, false);
  prepare.click();
  assert.equal(preview.hidden, true, 'old report must not appear to be the refreshed result');
  finish({success:false}); await tick();
  assert.equal(preview.value, '');
  assert.equal(button('Download report').hidden, true);
  assert.equal(prepare.disabled, false);
});

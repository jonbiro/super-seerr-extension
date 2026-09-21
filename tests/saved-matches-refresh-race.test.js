const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
test('an inspection started before forgetting a match cannot restore its row', async t => {
  const dom = new JSDOM('<main></main>', {runScripts:'outside-only'}); t.after(() => dom.window.close());
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const entry = {key:'[]',title:'Example',selectedTitle:'Example',year:2000,mediaType:'movie',tmdbId:1};
  let reads = 0, finish;
  dom.window.chrome = {runtime:{sendMessage: async ({action}) => {
    if (action === 'removeTitleCorrection') return {success:true};
    if (++reads === 1) return {success:true,data:[entry]};
    return new Promise(resolve => {finish = resolve;});
  }}};
  dom.window.eval(fs.readFileSync('src/options/support-tools.js','utf8'));
  const button = name => [...dom.window.document.querySelectorAll('button')].find(b => b.textContent === name);
  button('Inspect saved title matches').click(); await tick();
  button('Inspect saved title matches').click();
  button('Forget match').click(); await tick();
  assert.equal(dom.window.document.querySelectorAll('li').length, 0);
  finish({success:true,data:[entry]}); await tick();
  assert.equal(dom.window.document.querySelectorAll('li').length, 0);
  assert.equal(button('Inspect saved title matches').disabled, false);
});

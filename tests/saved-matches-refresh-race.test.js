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

for (const success of [true, false]) test(`pending match removal survives filtering and inspection (${success ? 'success' : 'failure'})`, async t => {
  const dom = new JSDOM('<main></main>', { runScripts: 'outside-only' }); t.after(() => dom.window.close());
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const entry = { key: '[]', title: 'Example', selectedTitle: 'Example', year: 2000, mediaType: 'movie', tmdbId: 1 };
  let removals = 0, finish;
  dom.window.chrome = { runtime: { sendMessage: async ({ action }) => {
    if (action === 'removeTitleCorrection') { removals++; return new Promise(resolve => { finish = resolve; }); }
    return { success: true, data: [entry] };
  } } };
  dom.window.eval(fs.readFileSync('src/options/support-tools.js', 'utf8'));
  const button = name => [...dom.window.document.querySelectorAll('button')].find(b => b.textContent === name);
  button('Inspect saved title matches').click(); await tick();
  button('Forget match').click();
  const search = dom.window.document.querySelector('input');
  search.value = 'absent'; search.dispatchEvent(new dom.window.Event('input'));
  search.value = ''; search.dispatchEvent(new dom.window.Event('input'));
  assert.equal(button('Forget match').disabled, true);
  button('Inspect saved title matches').click(); await tick();
  assert.equal(button('Forget match').disabled, true);
  button('Forget match').dispatchEvent(new dom.window.Event('click'));
  assert.equal(removals, 1, 're-rendering must not allow a duplicate mutation');
  finish({ success }); await tick();
  if (success) assert.equal(dom.window.document.querySelectorAll('li').length, 0);
  else {
    assert.equal(button('Forget match').disabled, false, 'the current rendered button must recover after failure');
    button('Forget match').click();
    assert.equal(removals, 2);
    finish({ success: true }); await tick();
    assert.equal(dom.window.document.querySelectorAll('li').length, 0);
  }
});

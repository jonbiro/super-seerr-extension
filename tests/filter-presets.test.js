const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(get, set) {
  const dom = new JSDOM('<div id="bar"><select class="seerr-sort-select"><option value="default">Default</option></select></div>', { runScripts: 'outside-only' });
  dom.window.chrome = { storage: { sync: { get, set } } };
  dom.window.eval(fs.readFileSync('src/content/FilterPresets.js', 'utf8'));
  const applied = [];
  dom.window.installFilterPresets({ bar: dom.window.document.getElementById('bar'), readCurrent: () => ({ sort: 'default', filters: { minCritics: 90 } }), apply: value => applied.push(value) });
  const wrapper = dom.window.document.querySelector('.seerr-filter-presets');
  return { dom, applied, wrapper, select: wrapper.querySelector('select'), name: wrapper.querySelector('input'), save: wrapper.querySelectorAll('button')[0], remove: wrapper.querySelectorAll('button')[1] };
}
const preset = { name: 'Night', sort: 'default', filters: { minCritics: 40 } };
function choose(f) { f.select.value = 'Night'; f.select.dispatchEvent(new f.dom.window.Event('change')); }

test('failed saves and deletions preserve the last successfully loaded preset', async t => {
  let fail = true;
  const f = fixture(async () => ({ seerrFilterPresetsV1: [preset] }), async () => { if (fail) throw new Error('Storage unavailable'); });
  t.after(() => f.dom.window.close()); await tick(); choose(f);
  f.save.click(); await tick(); choose(f);
  assert.equal(f.applied.at(-1).filters.minCritics, 40);
  assert.match(f.wrapper.textContent, /Applied Night/);
  f.remove.click(); await tick();
  assert.match(f.wrapper.textContent, /Could not delete/);
  choose(f); assert.equal(f.applied.at(-1).filters.minCritics, 40);
  fail = false; f.save.click(); await tick(); choose(f);
  assert.equal(f.applied.at(-1).filters.minCritics, 90);
  f.remove.click(); await tick();
  assert.equal(f.select.options.length, 1); assert.equal(f.name.value, '');
});

test('initial reads and pending writes disable every preset control', async t => {
  let resolveRead, resolveWrite, reads = 0;
  const f = fixture(() => ++reads === 1 ? new Promise(resolve => { resolveRead = resolve; }) : Promise.resolve({ seerrFilterPresetsV1: [preset] }), () => new Promise(resolve => { resolveWrite = resolve; }));
  t.after(() => f.dom.window.close());
  assert.equal(f.save.disabled, true); f.save.click(); assert.equal(reads, 1);
  resolveRead({ seerrFilterPresetsV1: [preset] }); await tick(); choose(f);
  f.save.click(); await tick();
  for (const node of [f.select, f.name, f.save, f.remove]) assert.equal(node.disabled, true);
  assert.equal(f.wrapper.getAttribute('aria-busy'), 'true');
  resolveWrite(); await tick();
  assert.equal(f.select.value, 'Night'); assert.equal(f.save.disabled, false);
});

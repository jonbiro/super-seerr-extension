const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(get, set) {
  const dom = new JSDOM('<div id="bar"><select class="seerr-sort-select"><option value="default">Default</option></select></div>', { runScripts: 'outside-only' });
  dom.window.chrome = { storage: { sync: { get, set } }, runtime: { sendMessage: require('./helpers/preset-bridge').presetBridge({ get, set }) } };
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
  await tick();
  assert.equal(f.save.disabled, true); f.save.click(); assert.equal(reads, 1);
  resolveRead({ seerrFilterPresetsV1: [preset] }); await tick(); choose(f);
  f.save.click(); await tick();
  for (const node of [f.select, f.name, f.save, f.remove]) assert.equal(node.disabled, true);
  assert.equal(f.wrapper.getAttribute('aria-busy'), 'true');
  resolveWrite(); await tick();
  assert.equal(f.select.value, 'Night'); assert.equal(f.save.disabled, false);
});

function delayedFixture() {
  const dom = new JSDOM('<div id="bar"><select class="seerr-sort-select"><option value="default">Default</option></select></div>', { runScripts: 'outside-only' });
  const pending = [], listeners = new Set();
  dom.window.chrome = { runtime: { sendMessage: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) }, storage: { onChanged: {
    addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn)
  } } };
  dom.window.eval(fs.readFileSync('src/content/FilterPresets.js', 'utf8'));
  const bar = dom.window.document.getElementById('bar');
  dom.window.installFilterPresets({ bar, readCurrent: () => ({ sort: 'default', filters: {} }), apply: () => {} });
  return { dom, bar, pending, listeners, change: () => listeners.forEach(fn => fn({ seerrFilterPresetsV1: {} }, 'sync')),
    finish: (i, name) => pending[i].resolve({ success: true, data: [{ ...preset, name }] }) };
}

test('a delayed initial preset read cannot replace newer cross-tab state', async t => {
  const f = delayedFixture(); t.after(() => f.dom.window.close());
  f.change(); f.finish(1, 'New'); await tick();
  f.finish(0, 'Old'); await tick();
  const select = f.bar.querySelector('.seerr-filter-presets select');
  assert.deepEqual([...select.options].map(option => option.textContent), ['Saved presets', 'New']);
  assert.equal(select.value, '');
});

test('late refresh errors and responses after cleanup do not alter current controls', async t => {
  const f = delayedFixture(); t.after(() => f.dom.window.close());
  f.finish(0, 'Initial'); await tick();
  f.change(); f.change(); f.finish(2, 'Current'); await tick();
  f.pending[1].reject(new Error('Old failure')); await tick();
  assert.doesNotMatch(f.bar.textContent, /Could not refresh/);
  f.change(); f.bar.__seerrPresetCleanup();
  f.finish(3, 'Detached'); await tick();
  assert.match(f.bar.textContent, /Current/);
  assert.doesNotMatch(f.bar.textContent, /Detached/);
  assert.equal(f.listeners.size, 0);
});

test('preset reload recovery follows newer cross-tab reads without losing the draft', async t => {
  const f = delayedFixture(); t.after(() => f.dom.window.close());
  f.finish(0, 'Initial'); await tick();
  const name = f.bar.querySelector('input'); name.value = 'Unsaved draft';
  f.change(); f.pending[1].reject(new Error('Read failed')); await tick();
  const retry = [...f.bar.querySelectorAll('button')].find(button => button.textContent === 'Retry loading presets');
  assert.equal(retry.hidden, false);
  retry.focus(); retry.click(); await tick();
  f.change(); f.finish(3, 'Latest'); await tick();
  f.pending[2].reject(new Error('Obsolete retry failure')); await tick();
  assert.equal(retry.hidden, true);
  assert.equal(name.value, 'Unsaved draft');
  assert.match(f.bar.textContent, /Latest/);
  assert.doesNotMatch(f.bar.querySelector('[role="status"]').textContent, /Could not/);
  assert.equal(f.dom.window.document.activeElement, f.bar.querySelector('.seerr-filter-presets select'));
});

for (const action of ['save', 'delete']) for (const writeSuccess of [true, false]) for (const readSuccess of [true, false]) {
  test(`obsolete ${action} reply preserves newer cross-tab state (write: ${writeSuccess}, read: ${readSuccess})`, async t => {
    const f = delayedFixture(); t.after(() => f.dom.window.close());
    f.finish(0, 'Night'); await tick();
    const select = f.bar.querySelector('.seerr-filter-presets select');
    const name = f.bar.querySelector('input');
    select.value = 'Night'; select.dispatchEvent(new f.dom.window.Event('change'));
    if (action === 'save') name.value = 'Draft';
    f.bar.querySelectorAll('button')[action === 'save' ? 0 : 1].click();
    f.change();
    if (readSuccess) f.finish(2, 'Latest');
    else f.pending[2].reject(new Error('Newer read failed'));
    await tick();
    const status = f.bar.querySelector('[role="status"]').textContent;
    const draft = name.value;
    const options = [...select.options].map(option => option.value);
    if (writeSuccess) f.pending[1].resolve({ success: true, data: action === 'save'
      ? [{ name: 'Draft', sort: 'default', filters: {} }] : [] });
    else f.pending[1].reject(new Error('Obsolete write failed'));
    await tick();
    assert.equal(f.bar.querySelector('[role="status"]').textContent, status);
    assert.equal(name.value, draft);
    assert.deepEqual([...select.options].map(option => option.value), options);
    assert.equal(f.bar.querySelector('.seerr-filter-presets').getAttribute('aria-busy'), 'false');
  });
}

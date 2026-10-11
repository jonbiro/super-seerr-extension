const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loadIntegration } = require('./helpers/integration');
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(t) {
  const page = loadIntegration();
  t.after(() => page.window.close());
  page.window.eval(fs.readFileSync('src/content/RatingQueue.js', 'utf8'));
  const queue = page.window.createRatingQueue(1), starts = [], releases = [];
  const add = (name, rect) => {
    const node = page.window.document.createElement('div');
    page.window.document.body.append(node);
    node.getBoundingClientRect = () => rect;
    const promise = queue.add(node, () => {
      starts.push(name);
      return new Promise(resolve => releases.push(resolve));
    });
    return { node, promise };
  };
  return { page, queue, starts, releases, add };
}

test('zero-size filtered cards and horizontally offscreen cards wait behind visible cards', async t => {
  const f = fixture(t);
  const jobs = [
    f.add('filtered', { top: 0, bottom: 0, left: 0, right: 0 }),
    f.add('horizontal', { top: 0, bottom: 20, left: 5000, right: 5020 }),
    f.add('visible', { top: 20, bottom: 40, left: 0, right: 20 })
  ];
  await tick();
  try { assert.deepEqual(f.starts, ['visible']); }
  finally { f.queue.clear(); f.releases.forEach(resolve => resolve()); await Promise.all(jobs.map(job => job.promise)); }
});

test('offscreen priority measures distance from both viewport edges', async t => {
  const f = fixture(t);
  const width = f.page.window.innerWidth, height = f.page.window.innerHeight;
  const jobs = [
    f.add('far right', { top: 0, bottom: 20, left: width + 500, right: width + 520 }),
    f.add('near below', { top: height + 10, bottom: height + 30, left: 0, right: 20 }),
    f.add('above', { top: -100, bottom: -80, left: 0, right: 20 })
  ];
  await tick();
  try { assert.deepEqual(f.starts, ['near below']); }
  finally { f.queue.clear(); f.releases.forEach(resolve => resolve()); await Promise.all(jobs.map(job => job.promise)); }
});

test('filtered cards can still resolve once visible work is finished', async t => {
  const f = fixture(t);
  const hidden = f.add('filtered', { top: 0, bottom: 0, left: 0, right: 0 });
  const visible = f.add('visible', { top: 10, bottom: 30, left: 0, right: 20 });
  await tick();
  try {
    assert.deepEqual(f.starts, ['visible']);
    f.releases[0](); await tick();
    assert.deepEqual(f.starts, ['visible', 'filtered'], 'hidden unrated cards must still get a chance to pass a score filter');
  } finally { f.queue.clear(); f.releases.forEach(resolve => resolve()); await Promise.all([hidden.promise, visible.promise]); }
});

for (const action of ['clear', 'detach']) {
  test(`${action} between queue dispatch and execution prevents abandoned work from starting`, async t => {
    const f = fixture(t);
    const node = f.page.window.document.createElement('div');
    f.page.window.document.body.append(node);
    let starts = 0;
    const old = f.queue.add(node, () => { starts++; return 99; });
    // Drain dispatches the job in one microtask and invokes its work in the
    // next. Navigation can clear the queue or remove its card in between.
    await Promise.resolve();
    if (action === 'clear') f.queue.clear();
    else node.remove();
    assert.equal(await old, null);
    assert.equal(starts, 0);
    const next = f.page.window.document.createElement('div');
    f.page.window.document.body.append(next);
    assert.equal(await f.queue.add(next, () => 80), 80, 'abandoned dispatch must release its queue slot');
  });
}

test('clearing already running work keeps the concurrency slot until that work settles', async t => {
  const f = fixture(t);
  const node = f.page.window.document.createElement('div');
  f.page.window.document.body.append(node);
  let release, signal;
  const old = f.queue.add(node, currentSignal => {
    signal = currentSignal;
    return new Promise(resolve => { release = resolve; });
  });
  await tick();
  f.queue.clear();
  let starts = 0;
  const next = f.queue.add(node, () => { starts++; return 80; });
  await tick();
  try {
    assert.equal(signal.aborted, true);
    assert.equal(starts, 0, 'clearing must not exceed the limit while an uncancelable provider still runs');
  } finally { release(null); }
  assert.equal(await old, null);
  assert.equal(await next, 80);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const { loadWorker } = require('./helpers/worker');

function message(worker, request, sender = { url: 'chrome-extension://test/src/popup/popup.html' }) {
  return new Promise(resolve => worker.api.handleMessage(request, sender, resolve));
}
async function setup(options) {
  const worker = loadWorker(options); await worker.ready;
  worker.context.chrome.runtime.getURL = path => `chrome-extension://test/${path}`;
  return worker;
}

test('confirmed actions persist only safe fields, coalesce storage writes, and survive restart', async () => {
  const worker = await setup();
  worker.api.apiKey = 'secret-key'; worker.api.plexToken = 'secret-token';
  worker.api.requestMedia = async () => ({ id: 42, secret: 'secret-key' });
  const replies = await Promise.all(Array.from({ length: 60 }, (_, i) => message(worker, {
    action: 'requestMedia', data: { title: `Film ${i} secret-key secret-token`, mediaType: 'movie', tmdbId: i + 1, token: 'secret-token' }
  })));
  assert.ok(replies.every(reply => reply.success));
  const history = (await message(worker, { action: 'getRecentActions' })).data;
  assert.equal(history.length, 50);
  assert.equal(new Set(history.map(entry => entry.title)).size, 50);
  assert.deepEqual(Object.keys(history[0]).sort(), ['at', 'kind', 'mediaType', 'title']);
  assert.doesNotMatch(JSON.stringify(worker.localStore), /secret-key|secret-token/);
  const restarted = await setup({ local: worker.localStore });
  assert.equal((await message(restarted, { action: 'getRecentActions' })).data.length, 50);
  await message(restarted, { action: 'clearRecentActions' });
  assert.equal((await message(restarted, { action: 'getRecentActions' })).data.length, 0);
});

test('failed requests and existing Plex watchlist entries do not claim new confirmed actions', async () => {
  const worker = await setup();
  worker.api.requestMedia = async () => { throw new Error('Unknown outcome'); };
  worker.api.plexAddToWatchlist = async () => ({ already: true });
  assert.equal((await message(worker, { action: 'requestMedia', data: { title: 'Film', mediaType: 'movie' } })).success, false);
  await message(worker, { action: 'plexAddToWatchlist', data: { title: 'Film', mediaType: 'movie' } });
  assert.equal((await worker.api.getRecentActions()).length, 0);
});

test('history storage failure cannot turn a successful server write into a failed reply', async () => {
  const worker = await setup(); let calls = 0;
  worker.api.requestMedia = async () => { calls++; return { id: 42 }; };
  worker.context.chrome.storage.local.set = async () => { throw new Error('Quota exceeded'); };
  const reply = await message(worker, { action: 'requestMedia', data: { title: 'Film', mediaType: 'movie' } });
  assert.equal(reply.success, true); assert.equal(calls, 1);
});

test('content scripts cannot read or clear history through worker messages', async () => {
  const worker = await setup();
  await worker.api.recordRecentAction('request', { title: 'Film', mediaType: 'movie' });
  for (const action of ['getRecentActions', 'clearRecentActions']) {
    const reply = await message(worker, { action }, { url: 'https://www.imdb.com/title/tt123', tab: { id: 1 } });
    assert.equal(reply.success, false);
  }
  assert.equal((await worker.api.getRecentActions()).length, 1);
});

test('popup history renders title text safely and clears through worker messages', async () => {
  const dom = new JSDOM(fs.readFileSync('src/popup/popup.html', 'utf8'), { runScripts: 'outside-only' });
  let entries = [{ kind: 'request', title: '<img src=x onerror=alert(1)>', mediaType: 'tv', at: Date.now() }];
  dom.window.chrome = { runtime: { sendMessage: async ({ action }) => {
    if (action === 'clearRecentActions') entries = [];
    return { success: true, data: entries };
  } } };
  dom.window.eval(fs.readFileSync('src/popup/recent-actions.js', 'utf8'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dom.window.document.querySelectorAll('#recentActionsList li').length, 1);
  assert.equal(dom.window.document.querySelectorAll('#recentActionsList img').length, 0);
  dom.window.document.getElementById('clearRecentActions').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dom.window.document.querySelectorAll('#recentActionsList li').length, 0);
  assert.match(dom.window.document.getElementById('recentActionsStatus').textContent, /No confirmed/);
  dom.window.close();
});

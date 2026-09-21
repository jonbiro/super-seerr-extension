const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker } = require('./helpers/worker');
const { loadIntegration } = require('./helpers/integration');
const media = { title: 'Example', mediaType: 'tv', tmdbId: 42 };
function details() {
  return { id: 42, name: 'Example', seasons: [0,1,2,3,4,5,6].map(seasonNumber => ({ seasonNumber, name: seasonNumber ? `Season ${seasonNumber}` : 'Specials', episodeCount: 8 })),
    mediaInfo: { seasons: [{ seasonNumber: 1, status: 5 }, { seasonNumber: 2, status: 4 }, { seasonNumber: 3, status: 3 }],
      requests: [{ is4k: false, status: 1, seasons: [{ seasonNumber: 4 }] }, { is4k: true, status: 1, seasons: [{ seasonNumber: 5 }] }] } };
}
async function setup() {
  const worker = loadWorker({ get: async () => ({ seerrUrl: 'https://seerr.example' }), local: { seerrApiKey: 'key' } }); await worker.ready;
  const state = { details: details(), posts: [], reads: 0 };
  worker.api.sendAPIRequest = async () => { state.reads++; return state.details; };
  worker.api.makeAPIRequest = async (method, endpoint, body) => {
    if (method === 'POST') { state.posts.push(body); return { id: 1 }; }
    return state.details;
  };
  return { ...worker, state };
}

test('season review distinguishes availability and existing requests without blocking standard quality for a 4K request', async () => {
  const { api } = await setup();
  const result = await api.getSeasonOptions(media);
  assert.deepEqual(Array.from(result.seasons, s => s.availability), ['Not available', 'Available', 'Partially available', 'Processing', 'Already requested', 'Not available', 'Not available']);
  assert.deepEqual(Array.from(result.seasons.filter(s => s.requestable), s => s.number), [0,5,6]);
});

test('TV requests post only selected seasons once and never default to all', async () => {
  const { api, state } = await setup();
  await api.requestMedia({ ...media, seasons: [6,5,5], seasonServer: 'https://seerr.example' });
  assert.equal(state.posts.length, 1);
  assert.deepEqual(Array.from(state.posts[0].seasons), [5,6]);
  assert.equal(state.posts[0].mediaId, 42);
  assert.equal(state.reads, 1, 'write validation fetches fresh availability');
});

test('invalid TV selections fail before traffic, and unavailable or unknown seasons never post', async () => {
  const { api, state } = await setup();
  for (const seasons of [undefined, null, 'all', [], [-1], [1.2], ['5'], [NaN]]) {
    await assert.rejects(api.requestMedia({ ...media, seasons }), /Choose at least one/);
  }
  assert.equal(state.reads, 0);
  for (const seasons of [[1], [2], [3], [4], [999]]) {
    await assert.rejects(api.requestMedia({ ...media, seasons }), /cannot be requested/);
  }
  assert.equal(state.posts.length, 0);
});

test('changed availability, configuration, and missing season data refuse the write', async () => {
  const { api, state } = await setup();
  const review = await api.getSeasonOptions(media);
  assert.ok(review.seasons.find(s => s.number === 5).requestable);
  state.details.mediaInfo.seasons.push({ seasonNumber: 5, status: 5 });
  await assert.rejects(api.requestMedia({ ...media, seasons: [5] }), /availability changed/);
  await assert.rejects(api.requestMedia({ ...media, seasons: [6], seasonServer: 'https://old.example' }), /Server changed/);
  delete state.details.seasons;
  await assert.rejects(api.requestMedia({ ...media, seasons: [6] }), /information is unavailable/);
  assert.equal(state.posts.length, 0);
});

test('season picker shows availability, requires a choice, and excludes disabled seasons from confirmation', async t => {
  const page = loadIntegration(); t.after(() => page.window.close());
  const ui = new page.window.UIComponents();
  const pending = ui.chooseSeasons({ title: 'Example', seasons: [
    { number: 1, name: 'Season 1', episodeCount: 8, availability: 'Available', requestable: false },
    { number: 2, name: 'Season 2', episodeCount: 8, availability: 'Not available', requestable: true }
  ] });
  const doc = page.window.document;
  const dialog = doc.querySelector('[role="dialog"]');
  assert.match(dialog.textContent, /Season 1.*Available/);
  const confirm = [...dialog.querySelectorAll('button')].find(b => /Request selected/.test(b.textContent));
  assert.equal(confirm.disabled, true);
  const inputs = dialog.querySelectorAll('input');
  assert.equal(inputs[0].disabled, true);
  inputs[0].checked = true; // even a tampered disabled box is omitted
  inputs[1].click();
  assert.equal(confirm.disabled, false);
  confirm.click();
  assert.deepEqual(Array.from(await pending), [2]);
});

test('cancelling season review or navigating away never sends a request', async t => {
  const page = loadIntegration({ site: 'imdb', sendMessage: async () => ({ success: true, data: { ...media, seasons: [{ number: 5, name: 'Season 5', episodeCount: 8, availability: 'Not available', requestable: true }] } }) });
  t.after(() => page.window.close());
  const integration = page.integration(); integration.mediaData = media;
  integration.currentStatusData = { status: 'available' }; integration.updateUIFromStatus = () => {}; integration.setUILoading = () => {};
  integration.client.requestMedia = async () => assert.fail('must not post');
  let pending = integration.handleRequestButtonClick();
  await new Promise(resolve => setImmediate(resolve));
  page.window.document.querySelector('[role="dialog"]').dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await pending;
  pending = integration.handleRequestButtonClick();
  await new Promise(resolve => setImmediate(resolve));
  integration.cleanupUI(); await pending;
  assert.equal(page.window.document.querySelector('.seerr-season-picker'), null);
});

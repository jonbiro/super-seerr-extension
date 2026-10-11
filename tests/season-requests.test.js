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

test('failed season requests can be retried while pending and approved requests remain blocked', async () => {
  const { api, state } = await setup();
  state.details.mediaInfo = { requests: [1, 2, 3, 4, 5].map(status => ({
    is4k: false, status, seasons: [{ seasonNumber: status }]
  })) };
  const review = await api.getSeasonOptions(media);
  assert.deepEqual(Array.from(review.seasons.filter(s => s.requestable), s => s.number), [0, 3, 4, 5, 6]);
  await api.requestMedia({ ...media, seasons: [4] });
  assert.equal(state.posts.length, 1);
  assert.deepEqual(Array.from(state.posts[0].seasons), [4]);
});

test('invalid episode counts and unknown availability cannot enable season requests', async () => {
  const { api, state } = await setup();
  state.details.seasons = [null, ...['8', 1.5, -1, 0, 8].map((episodeCount, seasonNumber) => ({ seasonNumber, episodeCount }))];
  state.details.mediaInfo = { seasons: [{ seasonNumber: 4 }] };
  const review = await api.getSeasonOptions(media);
  assert.equal(review.seasons.length, 5);
  assert.ok(review.seasons.every(season => !season.requestable));
  assert.equal(review.seasons[4].availability, 'Status unknown');
  for (const seasons of [[0], [1], [4]]) await assert.rejects(api.requestMedia({ ...media, seasons }), /cannot be requested/);
  assert.equal(state.posts.length, 0);
});

test('malformed availability fails with an actionable message before any write', async () => {
  const { api, state } = await setup();
  for (const mediaInfo of [
    'invalid', { status: '6' }, { seasons: {} }, { seasons: [null] }, { requests: {} }, { requests: [null] },
    { requests: [{ status: 1 }] },
    { requests: [{ status: 1, seasons: {} }] },
    { requests: [{ status: 1, seasons: [null] }] },
    { requests: [{ status: 'unknown', seasons: [{ seasonNumber: 6 }] }] }
  ]) {
    state.details.mediaInfo = mediaInfo;
    await assert.rejects(api.requestMedia({ ...media, seasons: [6] }), /Season availability is unavailable.*Try again/);
  }
  assert.equal(state.posts.length, 0);
});

test('conflicting availability records stay unknown and cannot allow a duplicate request', async () => {
  const { api, state } = await setup();
  state.details.mediaInfo = { seasons: [{ seasonNumber: 6, status: 5 }, { seasonNumber: 6, status: 1 }] };
  const review = await api.getSeasonOptions(media);
  assert.equal(review.seasons.find(season => season.number === 6).availability, 'Status unknown');
  await assert.rejects(api.requestMedia({ ...media, seasons: [6] }), /cannot be requested/);
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

for (const id of [undefined, null, 99, [42], ['42'], true, '4.2e1', Number.MAX_SAFE_INTEGER + 1]) {
  test(`season availability for an invalid or different title ID (${JSON.stringify(id)}) cannot authorize a request`, async () => {
    const { api, state } = await setup();
    state.details.id = id;
    await assert.rejects(api.requestMedia({ ...media, seasons: [6] }), /Season information is unavailable.*title.*Try again/);
    assert.equal(state.posts.length, 0);
    await assert.rejects(api.getSeasonOptions(media), /Season information is unavailable.*title.*Try again/);
  });
}

test('a numeric string identity in fresh season details validates the intended TV title', async () => {
  const { api, state } = await setup();
  state.details.id = '42';
  const review = await api.getSeasonOptions(media);
  assert.equal(review.tmdbId, 42);
  assert.equal(review.seasons.find(season => season.number === 6).requestable, true);
  await api.requestMedia({ ...media, seasons: [6] });
  assert.equal(state.posts.length, 1);
  assert.equal(state.posts[0].mediaId, 42);
});

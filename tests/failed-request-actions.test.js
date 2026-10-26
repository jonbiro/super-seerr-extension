const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker } = require('./helpers/worker');
const { loadIntegration } = require('./helpers/integration');
const { result: requestResult } = require('./helpers/request-receipt');

for (const mediaType of ['movie', 'tv']) test(`a failed ${mediaType} opens its existing Seerr title without submitting another request`, async t => {
  const page = loadIntegration({ site: 'imdb' }); t.after(() => page.window.close());
  const { api } = loadWorker();
  api.baseUrl = 'https://seerr.example/base///';
  const integration = page.integration();
  integration.mediaData = { title: 'Example', mediaType, tmdbId: 42 };
  integration.currentStatusData = api.formatMediaStatus({ id: 7, type: mediaType, status: 4,
    media: { tmdbId: 42, title: 'Example', status: 1 } }, mediaType);
  let writes = 0; const opened = [];
  page.window.open = url => { opened.push(url); return { opener: {} }; };
  integration.client.requestMedia = async () => { writes++; return { id: 7 }; };
  integration.client.sendMessage = async () => ({ success: true, data: { tmdbId: 42, server: api.baseUrl } });
  integration.ui.chooseSeasons = async () => [1];
  integration.ui.createNotification = () => {};
  integration.setUILoading = () => {};
  integration.deferViewAction = () => {};
  integration.updateUIFromStatus = () => {};
  await integration.handleRequest();
  assert.equal(writes, 0);
  assert.deepEqual(opened, [`https://seerr.example/base/${mediaType}/42`]);
});

test('a failed TV request still offers new seasons and the independent Plex action', async t => {
  const page = loadIntegration({ site: 'imdb' }); t.after(() => page.window.close());
  const { api } = loadWorker();
  const integration = page.integration();
  integration.mediaData = { title: 'Example', mediaType: 'tv', tmdbId: 42 };
  integration.currentStatusData = api.formatMediaStatus({ id: 7, type: 'tv', status: 4, media: { tmdbId: 42, status: 1 } }, 'tv');
  const doc = page.window.document;
  const elements = { seasonButton: doc.createElement('button'), plexButton: doc.createElement('button') };
  elements.plexButton.append(doc.createElement('span'));
  integration.ui.updateFlyoutStatus(elements, integration.currentStatusData, { plexConfigured: true });
  assert.equal(elements.seasonButton.disabled, false);
  assert.equal(elements.seasonButton.style.display, 'flex');
  assert.equal(elements.plexButton.style.display, 'flex');
  const writes = [];
  integration.client.sendMessage = async () => ({ success: true, data: { tmdbId: 42, server: 'https://seerr.example' } });
  integration.ui.chooseSeasons = async () => [6];
  integration.client.requestMedia = async data => { writes.push(data); return requestResult(data); };
  integration.ui.createNotification = () => {};
  integration.setUILoading = () => {};
  integration.deferViewAction = () => {};
  await integration.handleRequest({ seasonsOnly: true });
  assert.equal(writes.length, 1);
  assert.deepEqual(Array.from(writes[0].seasons), [6]);
});

test('a request warning stays visible without scheduling the success flyout close', async t => {
  const page = loadIntegration({ site: 'imdb' }); t.after(() => page.window.close());
  const integration = page.integration();
  integration.mediaData = { title: 'Example', mediaType: 'movie', tmdbId: 42 };
  integration.currentStatusData = { status: 'unrequested' };
  integration.uiTheme = 'flyout'; integration.isFlyoutExpanded = () => true;
  const notices = [], deferred = [];
  integration.ui.createNotification = (...args) => notices.push(args);
  integration.setUILoading = () => {};
  integration.deferViewAction = (_, callback, delay) => deferred.push(delay);
  integration.client.requestMedia = async () => ({ notice: 'The request was created but failed in Seerr.' });
  await integration.handleRequest();
  assert.equal(notices[0][0], 'Request Needs Review');
  assert.equal(notices[0][2], 'warning');
  assert.equal(notices[0][3], 0, 'a request warning stays available until dismissed');
  assert.match(notices[0][1], /failed in Seerr/);
  assert.deepEqual(deferred, [2000]);
});

for (const manageUrl of [undefined, 'javascript:alert(1)', 'https://key:secret@seerr.example/movie/42']) {
  test(`an invalid failed-request destination cannot open or trigger another request (${manageUrl})`, async t => {
    const page = loadIntegration({ site: 'imdb' }); t.after(() => page.window.close());
    const integration = page.integration();
    integration.mediaData = { title: 'Example', mediaType: 'movie', tmdbId: 42 };
    integration.currentStatusData = { status: 'failed', action: 'manageRequest', manageUrl };
    let opened = 0, writes = 0;
    page.window.open = () => { opened++; return { opener: null }; };
    integration.client.requestMedia = async () => { writes++; return requestResult(integration.mediaData); };
    const notices = [];
    integration.ui.createNotification = (...args) => notices.push(args);
    integration.updateUIFromStatus = () => {};
    await integration.handleRequest();
    assert.equal(opened, 0);
    assert.equal(writes, 0);
    assert.equal(notices[0][0], 'Could Not Open Seerr');
  });
}

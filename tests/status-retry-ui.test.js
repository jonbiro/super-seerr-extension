const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadIntegration } = require('./helpers/integration');

test('a status error replaces stale watch data and retries a read, never a POST', async t => {
  const page = loadIntegration({ site: 'imdb' });
  t.after(() => page.window.close());
  const integration = page.integration();
  integration.mediaData = { title: 'Example', mediaType: 'movie', tmdbId: 1 };
  integration.uiTheme = 'button';
  integration.ui.updateButtonStatus = () => {};
  integration.currentStatusData = { status: 'available_watch', watchUrl: 'https://old.example' };
  let reads = 0, writes = 0;
  integration.client.getMediaStatus = async () => { reads++; throw new Error('HTTP 401'); };
  integration.client.requestMedia = async () => { writes++; };
  await integration.updateStatus();
  assert.equal(integration.currentStatusData.action, 'retryStatus');
  assert.equal(integration.currentStatusData.watchUrl, undefined);
  await integration.handleRequest();
  assert.equal(reads, 2);
  assert.equal(writes, 0);
  assert.equal(integration._requestInFlight, false);
});

test('a missing playback URL never turns a watch click into a request', async t => {
  const page = loadIntegration({ site: 'imdb' });
  t.after(() => page.window.close());
  const integration = page.integration();
  integration.mediaData = { title: 'Example', mediaType: 'movie', tmdbId: 1 };
  integration.currentStatusData = { status: 'available_watch' };
  integration.setUILoading = () => {};
  integration.updateUIFromStatus = () => {};
  integration.ui.createNotification = () => {};
  integration.client.getMediaStatus = async () => ({ status: 'error', action: 'retryStatus' });
  integration.handleRequestButtonClick = async () => assert.fail('a watch click must not post');
  await integration.handleWatchButtonClick();
  assert.equal(integration.currentStatusData.action, 'retryStatus');
});

test('ambiguous matches open Seerr search for an explicit choice without posting', async t => {
  const page = loadIntegration({ site: 'imdb', sendMessage: async () => ({ success: true, data: { serverUrl: 'https://seerr.example/base/' } }) });
  t.after(() => page.window.close());
  const integration = page.integration();
  integration.mediaData = { title: 'The Thing', mediaType: 'movie' };
  integration.currentStatusData = { status: 'unmatched', action: 'choose' };
  let opened;
  page.window.open = url => { opened = url; };
  integration.client.requestMedia = async () => { assert.fail('must not post'); };
  await integration.handleRequest();
  assert.equal(opened, 'https://seerr.example/base/search?query=The+Thing');
});

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

test('ambiguous matches require an explicit picker choice before refreshing status, never posting', async t => {
  const candidates = [
    { tmdbId: 1, title: 'The Thing', mediaType: 'movie', year: 1982, overview: 'Antarctica' },
    { tmdbId: 2, title: 'The Thing', mediaType: 'movie', year: 2011, overview: 'Prequel' }
  ];
  const page = loadIntegration({ site: 'imdb', sendMessage: async message => ({ success: true, data: message.action === 'getMediaCandidates' ? candidates : {} }) });
  t.after(() => page.window.close());
  const integration = page.integration();
  integration.mediaData = { title: 'The Thing', mediaType: 'movie' };
  integration.currentStatusData = { status: 'unmatched', action: 'choose' };
  integration.client.requestMedia = async () => { assert.fail('must not post'); };
  let selected;
  integration.updateStatus = async () => { selected = integration.mediaData; };
  const pending = integration.handleRequest();
  await new Promise(resolve => setImmediate(resolve));
  const choices = page.window.document.querySelectorAll('.seerr-title-choice');
  assert.equal(choices.length, 2);
  assert.match(choices[1].textContent, /2011/);
  assert.equal(selected, undefined);
  choices[1].click();
  await pending;
  assert.equal(selected.tmdbId, 2);
  assert.equal(selected.year, 2011);
  assert.equal(page.window.document.querySelector('[role="dialog"]'), null);
});

test('navigation dismisses a pending picker and preserves the next page identity', async t => {
  const page = loadIntegration({ site: 'imdb', sendMessage: async () => ({ success: true, data: [
    { tmdbId: 1, title: 'The Thing', mediaType: 'movie', year: 1982 }
  ] }) });
  t.after(() => page.window.close());
  const integration = page.integration();
  integration.mediaData = { title: 'The Thing', mediaType: 'movie' };
  integration.currentStatusData = { action: 'choose' };
  const pending = integration.handleRequest();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(page.window.document.querySelector('.seerr-title-picker'));
  integration.cleanupUI();
  integration.mediaData = { title: 'New page', mediaType: 'movie' };
  await pending;
  assert.equal(page.window.document.querySelector('.seerr-title-picker'), null);
  assert.equal(integration.mediaData.title, 'New page');
});

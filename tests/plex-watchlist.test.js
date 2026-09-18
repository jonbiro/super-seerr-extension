// Plex Watchlist: token stays local, resolution is exact, writes are single PUTs,
// and the Plex button shows for available titles where the Seerr button hides.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loadWorker } = require('./helpers/worker');

function jsonResponse(data, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => (/json/i.test(name) ? 'application/json' : null) },
    json: async () => data,
    text: async () => JSON.stringify(data)
  };
}

function plexSearchJson(items) {
  return {
    MediaContainer: {
      SearchResults: [{
        id: 'external',
        SearchResult: items.map(item => ({
          Metadata: {
            ratingKey: item.ratingKey,
            title: item.title,
            type: item.type,
            year: item.year,
            guid: `plex://movie/${item.ratingKey}`
          }
        }))
      }]
    }
  };
}

function plexDetailJson(tmdbId) {
  return { MediaContainer: { Metadata: [{ ratingKey: 'abc', Guid: [{ id: `tmdb://${tmdbId}` }] }] } };
}

test('getConfigState reports plexConfigured without leaking the token', async () => {
  const worker = loadWorker({ get: async () => ({ seerrUrl: 'https://seerr.example' }), local: { plexToken: 'plex-secret' } });
  await worker.ready;
  const response = await new Promise(resolve => worker.api.handleMessage({ action: 'getConfigState' }, {}, resolve));
  assert.equal(response.success, true);
  assert.equal(response.data.plexConfigured, true);
  assert.ok(!JSON.stringify(response).includes('plex-secret'), 'token must not cross the message boundary');
});

test('getConfigState reports plexConfigured false when no token', async () => {
  const worker = loadWorker({ get: async () => ({ seerrUrl: 'https://seerr.example' }), local: {} });
  await worker.ready;
  const response = await new Promise(resolve => worker.api.handleMessage({ action: 'getConfigState' }, {}, resolve));
  assert.equal(response.data.plexConfigured, false);
});

test('plexTestConnection accepts an unsaved token without storing it', async () => {
  const calls = [];
  const worker = loadWorker({
    get: async () => ({}),
    local: {},
    fetch: async (url, options) => {
      calls.push({ url: String(url), token: options.headers['X-Plex-Token'] });
      assert.ok(String(url).startsWith('https://plex.tv/api/v2/user'));
      return jsonResponse({ username: 'plex-user' });
    }
  });
  await worker.ready;
  const response = await new Promise(resolve => worker.api.handleMessage(
    { action: 'plexTestConnection', data: { plexToken: 'unsaved-token' } }, {}, resolve));
  assert.equal(response.success, true);
  assert.equal(response.data.user, 'plex-user');
  assert.equal(calls[0].token, 'unsaved-token');
  assert.equal(worker.localStore.plexToken, undefined, 'test must not save');
});

test('plex resolution matches TMDB GUID even when it is not ranked first', async () => {
  const seen = [];
  const worker = loadWorker({
    get: async () => ({}),
    local: { plexToken: 't' },
    fetch: async (url, options) => {
      seen.push(String(url));
      const href = String(url);
      if (href.includes('/library/search')) {
        return jsonResponse(plexSearchJson([
          { ratingKey: 'wrong1', title: 'Dune', type: 'movie', year: 2021 },
          { ratingKey: 'right1', title: 'Dune', type: 'movie', year: 2021 }
        ]));
      }
      if (href.includes('/library/metadata/wrong1')) return jsonResponse(plexDetailJson(999999));
      if (href.includes('/library/metadata/right1')) return jsonResponse(plexDetailJson(438631));
      if (href.includes('/userState')) return jsonResponse({ MediaContainer: {} });
      if (href.includes('/actions/addToWatchlist')) return jsonResponse({});
      throw new Error(`unexpected fetch ${href}`);
    }
  });
  await worker.ready;
  const resolved = await worker.api.plexResolveRatingKey({ title: 'Dune', year: 2021, mediaType: 'movie', tmdbId: 438631 });
  assert.equal(resolved.ratingKey, 'right1');
});

test('plex title-only resolution refuses ambiguous matches', async () => {  const worker = loadWorker({
    get: async () => ({}),
    local: { plexToken: 't' },
    fetch: async url => {
      if (String(url).includes('/library/search')) {
        return jsonResponse(plexSearchJson([
          { ratingKey: 'a1', title: 'Dune', type: 'movie', year: null },
          { ratingKey: 'a2', title: 'Dune', type: 'movie', year: null }
        ]));
      }
      return jsonResponse({});
    }
  });
  await worker.ready;
  await assert.rejects(
    () => worker.api.plexResolveRatingKey({ title: 'Dune', mediaType: 'movie' }),
    /ambiguous/i);
});

test('plexAddToWatchlist PUTs once to the Discover action with the ratingKey', async () => {
  const puts = [];
  const worker = loadWorker({
    get: async () => ({}),
    local: { plexToken: 't' },
    fetch: async (url, options) => {
      const href = String(url);
      if (href.includes('/library/search')) {
        return jsonResponse(plexSearchJson([{ ratingKey: 'rk123', title: 'Dune', type: 'movie', year: 2021 }]));
      }
      if (href.includes('/library/metadata/rk123') && !href.includes('userState')) {
        return jsonResponse(plexDetailJson(438631));
      }
      if (href.includes('/userState')) return jsonResponse({ MediaContainer: {} });
      if (href.includes('/actions/addToWatchlist')) {
        puts.push({ href, method: options.method, token: options.headers['X-Plex-Token'] });
        return jsonResponse({});
      }
      throw new Error(`unexpected ${href}`);
    }
  });
  await worker.ready;
  const result = await worker.api.plexAddToWatchlist({ title: 'Dune', year: 2021, mediaType: 'movie', tmdbId: 438631 });
  assert.equal(result.ratingKey, 'rk123');
  assert.equal(puts.length, 1, 'a write is sent exactly once, never retried');
  assert.equal(puts[0].method, 'PUT');
  assert.ok(puts[0].href.includes('ratingKey=rk123'));
  assert.equal(puts[0].token, 't');
});

test('plexAddToWatchlist reports already-on-watchlist without a PUT', async () => {
  let puts = 0;
  const worker = loadWorker({
    get: async () => ({}),
    local: { plexToken: 't' },
    fetch: async url => {
      const href = String(url);
      if (href.includes('/library/search')) {
        return jsonResponse(plexSearchJson([{ ratingKey: 'rk1', title: 'Dune', type: 'movie', year: 2021 }]));
      }
      if (href.includes('/userState')) {
        return jsonResponse({ MediaContainer: { UserState: [{ watchlistedAt: 1700000000 }] } });
      }
      if (href.includes('/library/metadata/')) return jsonResponse(plexDetailJson(438631));
      if (href.includes('/actions/addToWatchlist')) { puts++; return jsonResponse({}); }
      return jsonResponse({});
    }
  });
  await worker.ready;
  const result = await worker.api.plexAddToWatchlist({ title: 'Dune', mediaType: 'movie', tmdbId: 438631 });
  assert.equal(result.already, true);
  assert.equal(puts, 0, 'no write when already watchlisted');
});

test('plexAddToWatchlist requires a token and refuses to guess', async () => {
  const worker = loadWorker({ get: async () => ({}), local: {} });
  await worker.ready;
  await assert.rejects(() => worker.api.plexAddToWatchlist({ title: 'Dune', mediaType: 'movie', tmdbId: 1 }), /Plex token/);
});

test('plex token is device-local and the overlay never reads it', () => {
  for (const file of ['src/background/background.js', 'src/options/options.js']) {
    const text = fs.readFileSync(file, 'utf8');
    const syncTouches = [...text.matchAll(/chrome\.storage\.sync\.(get|set)\(([^)]*)\)/g)]
      .filter(match => match[2].includes('plexToken'));
    assert.equal(syncTouches.length, 0, `${file} must keep plexToken out of sync storage`);
  }
  const overlay = fs.readFileSync('src/content/seerr-integration.js', 'utf8');
  // Mirrors the seerrApiKey contract: listening for changes.plexToken only
  // learns that the token changed; reading the value would need 'plexToken''.
  assert.ok(!overlay.includes("plexToken'"), 'overlay must not read the Plex token value');
  assert.ok(overlay.includes('plexConfigured'), 'overlay asks the worker whether Plex is available');
  for (const file of ['src/content/seerr-integration.js', 'src/shared/BaseIntegration.js', 'src/shared/UIComponents.js']) {
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!/chrome\.storage\.(local|sync)\.(get|set)\([^)]*plexToken/.test(text), `${file} must not touch plexToken in storage`);
  }
});

test('flyout Plex button shows for available titles when configured, hides otherwise', async () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<body></body>', { url: 'https://www.imdb.com/title/tt0111161/', runScripts: 'outside-only' });
  const { window } = dom;
  window.eval(fs.readFileSync('src/shared/UIComponents.js', 'utf8'));
  const ui = new window.UIComponents({ siteName: 'TEST' });
  const panel = window.document.createElement('div');
  const elements = ui.createFlyoutContent({ title: 'Dune', year: 2021, mediaType: 'movie' }, panel);
  assert.ok(elements.plexButton, 'flyout builds a Plex button');

  const availableWatch = { status: 'available_watch', buttonClass: 'watch', message: 'Available on Plex' };
  ui.updateFlyoutStatus(elements, availableWatch, { plexConfigured: true });
  assert.equal(elements.plexButton.style.display, 'flex', 'available titles can go to Plex');
  // The Seerr button still hides for available titles; Plex is the path.
  assert.equal(elements.watchlistButton.style.display, 'none');

  ui.updateFlyoutStatus(elements, availableWatch, { plexConfigured: false });
  assert.equal(elements.plexButton.style.display, 'none', 'no token means no Plex button');

  ui.updateFlyoutStatus(elements, availableWatch, {});
  assert.equal(elements.plexButton.style.display, 'none');

  for (const blocked of [
    { status: 'loading', message: 'x' },
    { status: 'error', message: 'x' },
    { status: 'available', buttonClass: 'request', action: 'choose', message: 'x' }
  ]) {
    ui.updateFlyoutStatus(elements, blocked, { plexConfigured: true });
    assert.equal(elements.plexButton.style.display, 'none', `hides for ${blocked.status}/${blocked.action || ''}`);
  }

  ui.updateFlyoutStatus(elements, { status: 'available', buttonClass: 'request', message: 'Ready' }, { plexConfigured: true });
  assert.equal(elements.plexButton.style.display, 'flex', 'requestable titles also offer Plex');
  dom.window.close();
});

test('plex handles collapsed single-object Discover shapes', async () => {
  const worker = loadWorker({
    get: async () => ({}),
    local: { plexToken: 't' },
    fetch: async url => {
      const href = String(url);
      if (href.includes('/library/search')) {
        // Plex collapses one-element arrays to a bare object.
        return jsonResponse({
          MediaContainer: { SearchResults: { id: 'external', SearchResult: { Metadata: { ratingKey: 'solo1', title: 'Dune', type: 'movie', year: 2021, guid: 'plex://movie/solo1' } } } }
        });
      }
      if (href.includes('/library/metadata/solo1') && !href.includes('userState')) {
        return jsonResponse({ MediaContainer: { Metadata: { ratingKey: 'solo1', Guid: { id: 'tmdb://438631' } } } });
      }
      if (href.includes('/userState')) return jsonResponse({ MediaContainer: {} });
      if (href.includes('/actions/addToWatchlist')) return jsonResponse({});
      throw new Error(`unexpected ${href}`);
    }
  });
  await worker.ready;
  const resolved = await worker.api.plexResolveRatingKey({ title: 'Dune', year: 2021, mediaType: 'movie', tmdbId: 438631 });
  assert.equal(resolved.ratingKey, 'solo1');
});

test('plex rejects Plex-origin requests outside the allowlist', async () => {
  const worker = loadWorker({ get: async () => ({}), local: { plexToken: 't' } });
  await worker.ready;
  await assert.rejects(() => worker.api.plexFetch('https://evil.example/watchlist', { token: 't' }), /allowed origins/);
});

test('plex encodes ratingKeys used in URL paths', async () => {
  const seen = [];
  const worker = loadWorker({
    get: async () => ({}),
    local: { plexToken: 't' },
    fetch: async url => { seen.push(String(url)); return jsonResponse({ MediaContainer: {} }); }
  });
  await worker.ready;
  await worker.api.plexUserState('ab/c?d', 't');
  assert.ok(seen[0].includes('ab%2Fc%3Fd'), `ratingKey must be encoded, saw ${seen[0]}`);
});

test('plex maps a network failure to an actionable error', async () => {
  const failure = new TypeError('Failed to fetch');
  const worker = loadWorker({
    get: async () => ({}),
    local: { plexToken: 't' },
    fetch: async () => { throw failure; }
  });
  await worker.ready;
  await assert.rejects(() => worker.api.plexTestConnection({ plexToken: 't' }), /Could not reach Plex/);
});

test('plex add returns a minimal shape with no raw provider payload', async () => {
  const worker = loadWorker({
    get: async () => ({}),
    local: { plexToken: 't' },
    fetch: async url => {
      const href = String(url);
      if (href.includes('/library/search')) {
        return jsonResponse(plexSearchJson([{ ratingKey: 'rk9', title: 'Dune', type: 'movie', year: 2021 }]));
      }
      if (href.includes('/library/metadata/rk9') && !href.includes('userState')) {
        return jsonResponse({ MediaContainer: { Metadata: [{ ratingKey: 'rk9', Guid: [{ id: 'tmdb://438631' }] }] } });
      }
      if (href.includes('/userState')) return jsonResponse({ MediaContainer: {} });
      return jsonResponse({ MediaContainer: { totalSize: 9999, Metadata: [{ big: 'payload' }] } });
    }
  });
  await worker.ready;
  const result = await worker.api.plexAddToWatchlist({ title: 'Dune', year: 2021, mediaType: 'movie', tmdbId: 438631 });
  // Cross-realm object: compare fields rather than prototypes.
  assert.equal(result.ratingKey, 'rk9');
  assert.equal(result.title, 'Dune');
  assert.equal(result.already, false);
  assert.ok(!('response' in result), 'no raw provider payload crosses the worker boundary');
});

test('plex distinguishes no match from ambiguous for title-only lookups', async () => {
  const empty = loadWorker({
    get: async () => ({}),
    local: { plexToken: 't' },
    fetch: async () => jsonResponse({ MediaContainer: { SearchResults: [] } })
  });
  await empty.ready;
  await assert.rejects(() => empty.api.plexResolveRatingKey({ title: 'Zzz Unknown', mediaType: 'movie' }), /No Plex match for/);
});

test('plex without a title says a title is needed, even with a TMDB id', async () => {
  const worker = loadWorker({ get: async () => ({}), local: { plexToken: 't' } });
  await worker.ready;
  await assert.rejects(
    () => worker.api.plexResolveRatingKey({ mediaType: 'movie', tmdbId: 438631 }),
    /needs a title/);
});

test('plex resolves a missing title from Seerr when the TMDB id is known', async () => {
  const seen = [];
  const worker = loadWorker({
    get: async () => ({ seerrUrl: 'https://seerr.example' }),
    local: { seerrApiKey: 'k', plexToken: 't' },
    fetch: async (url, options) => {
      const href = String(url);
      seen.push(href);
      // Seerr detail lookup fills the title Seerr withheld from the card.
      if (href.startsWith('https://seerr.example/api/v1/movie/438631')) {
        return jsonResponse({ id: 438631, title: 'Dune' });
      }
      if (href.includes('discover.provider.plex.tv/library/search')) {
        return jsonResponse(plexSearchJson([{ ratingKey: 'rk9', title: 'Dune', type: 'movie', year: 2021 }]));
      }
      if (href.includes('/library/metadata/rk9') && !href.includes('userState')) {
        return jsonResponse({ MediaContainer: { Metadata: [{ ratingKey: 'rk9', Guid: [{ id: 'tmdb://438631' }] }] } });
      }
      if (href.includes('/userState')) return jsonResponse({ MediaContainer: {} });
      if (href.includes('/actions/addToWatchlist')) return jsonResponse({});
      throw new Error(`unexpected ${href}`);
    }
  });
  await worker.ready;
  // Empty title, as sent for an un-hovered Seerr card.
  const result = await worker.api.plexAddToWatchlist({ mediaType: 'movie', tmdbId: 438631, title: '' });
  assert.equal(result.ratingKey, 'rk9');
  assert.equal(result.title, 'Dune');
  assert.ok(seen.some(href => href.includes('/api/v1/movie/438631')), 'the title is resolved from Seerr first');
});

test('plex without title or Seerr access still refuses rather than guessing', async () => {
  const worker = loadWorker({
    get: async () => ({ seerrUrl: 'https://seerr.example' }),
    local: { seerrApiKey: 'k', plexToken: 't' },
    fetch: async url => {
      if (String(url).startsWith('https://seerr.example')) {
        return { ok: false, status: 404, headers: { get: () => 'application/json' }, text: async () => 'not found', json: async () => ({}) };
      }
      throw new Error(`unexpected ${url}`);
    }
  });
  await worker.ready;
  await assert.rejects(
    () => worker.api.plexAddToWatchlist({ mediaType: 'movie', tmdbId: 438631, title: '' }),
    /needs a title/);
});

// Seerr grid cards: the overlay injects one Plex button per identified card,
// idempotently, and only when the worker reports a Plex token.
function openSeerrGrid({ plexConfigured = true, apiConfigured = false, overlayFeatures = undefined, onPlexAdd = null } = {}) {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(`<main><div id="grid">
    <article data-testid="title-card"><a href="/movie/123"><h2>Dune</h2></a></article>
    <article data-testid="title-card"><a href="/tv/456"><h2>Severance</h2></a></article>
    <article data-testid="title-card"><span class="no-link">Unknown</span></article>
  </div></main>`, { url: 'https://seerr.example/discover', runScripts: 'outside-only' });
  const { window } = dom;
  const messages = [];
  window.chrome = {
    storage: {
      sync: { get: async () => ({ seerrUrl: 'https://seerr.example', ...(overlayFeatures ? { overlayFeatures } : {}) }) },
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      onChanged: { addListener() {} }
    },
    runtime: { sendMessage: async message => {
      messages.push(message);
      if (message.action === 'getConfigState') {
        return { success: true, data: { apiConfigured, serverUrl: 'https://seerr.example', plexConfigured } };
      }
      if (message.action === 'plexAddToWatchlist') {
        if (onPlexAdd) return onPlexAdd(message);
        return { success: true, data: { ratingKey: 'rk1', already: false } };
      }
      return { success: true, data: null };
    } }
  };
  window.fetch = async () => ({ ok: true, json: async () => ({ results: [] }) });
  for (const file of ['RatingsModel', 'RatingsConfig']) {
    window.eval(fs.readFileSync(`src/shared/${file}.js`, 'utf8'));
  }
  require('./helpers/overlay-modules').loadOverlayModules(window);
  const source = fs.readFileSync('src/content/seerr-integration.js', 'utf8');
  window.eval(source.replace(/\}\)\(\);\s*$/, `window.testOverlay = {
    injectPlexCardButtons, removePlexCardButtons, toggleBulkMode, detectRoute
  }; })();`));
  return { dom, window, messages };
}

const gridSettle = async (window, tries = 60) => {
  for (let i = 0; i < tries; i++) {
    window.testOverlay.injectPlexCardButtons();
    if (window.document.querySelectorAll('.seerr-plex-card-button').length > 0) return true;
    await new Promise(resolve => setImmediate(resolve));
  }
  return window.document.querySelectorAll('.seerr-plex-card-button').length > 0;
};

test('grids gain one Plex button per identified card', async t => {
  const fixture = openSeerrGrid();
  t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.dom.window.close(); });
  assert.ok(await gridSettle(fixture.window), 'buttons inject once plexConfigured resolves');

  const buttons = fixture.window.document.querySelectorAll('.seerr-plex-card-button');
  assert.equal(buttons.length, 2, 'linked movie + tv cards get buttons; the linkless card does not');
  // Second pass adds nothing.
  fixture.window.testOverlay.injectPlexCardButtons();
  assert.equal(fixture.window.document.querySelectorAll('.seerr-plex-card-button').length, 2);
  assert.equal(buttons[0].getAttribute('aria-label'), 'Add Dune to Plex Watchlist');
});

test('card button adds that card title to Plex without navigating', async t => {
  const fixture = openSeerrGrid();
  t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.dom.window.close(); });
  assert.ok(await gridSettle(fixture.window));

  const card = fixture.window.document.querySelector('a[href="/tv/456"]').closest('[data-testid="title-card"]');
  const button = card.querySelector('.seerr-plex-card-button');
  let navigated = false;
  card.addEventListener('click', () => { navigated = true; });
  button.click();
  for (let i = 0; i < 20 && button.textContent !== '✓'; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  const adds = fixture.messages.filter(message => message.action === 'plexAddToWatchlist');
  assert.equal(adds.length, 1);
  // Cross-realm object: compare fields rather than prototypes.
  assert.equal(adds[0].data.tmdbId, 456);
  assert.equal(adds[0].data.title, 'Severance');
  assert.equal(adds[0].data.mediaType, 'tv');
  assert.equal(button.textContent, '✓');
  assert.equal(navigated, false, 'the card click must not fire through the button');
});

test('card button reports an already-watchlisted title distinctly', async t => {
  const fixture = openSeerrGrid({ onPlexAdd: () => ({ success: true, data: { ratingKey: 'rk1', already: true } }) });
  t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.dom.window.close(); });
  assert.ok(await gridSettle(fixture.window));

  const button = fixture.window.document.querySelector('.seerr-plex-card-button');
  button.click();
  for (let i = 0; i < 20 && button.textContent !== '✓'; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(button.title, 'Already on Plex Watchlist');
  assert.ok(fixture.window.document.querySelector('.seerr-notification.success'), 'a confirmation shows');
});

test('card buttons stay away without a Plex token or when toggled off', async t => {
  for (const options of [{ plexConfigured: false }, { overlayFeatures: { plexWatchlist: false } }]) {
    const fixture = openSeerrGrid(options);
    try {
      for (let i = 0; i < 30; i++) await new Promise(resolve => setImmediate(resolve));
      fixture.window.testOverlay.injectPlexCardButtons();
      assert.equal(
        fixture.window.document.querySelectorAll('.seerr-plex-card-button').length, 0,
        `no buttons for ${JSON.stringify(options)}`);
    } finally {
      fixture.window.dispatchEvent(new fixture.window.Event('pagehide'));
      fixture.dom.window.close();
    }
  }
});

test('bulk selection stands the card buttons down and restores them after', async t => {
  const fixture = openSeerrGrid({ apiConfigured: true });
  t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.dom.window.close(); });
  assert.ok(await gridSettle(fixture.window));

  fixture.window.testOverlay.toggleBulkMode();
  assert.equal(fixture.window.document.querySelectorAll('.seerr-plex-card-button').length, 0);
  assert.ok(fixture.window.document.querySelector('.seerr-select-checkbox'), 'checkboxes take the corner instead');

  fixture.window.testOverlay.toggleBulkMode();
  assert.equal(fixture.window.document.querySelectorAll('.seerr-plex-card-button').length, 2);
});

test('saving with a token but a declined Plex grant says so instead of success-as-usual', async t => {
  const { JSDOM } = require('jsdom');
  const html = fs.readFileSync('src/options/options.html', 'utf8');
  const dom = new JSDOM(html, { url: 'chrome-extension://test/options.html', runScripts: 'outside-only' });
  const { window } = dom;
  t.after(() => dom.window.close());
  window.chrome = {
    storage: {
      sync: { get: async () => ({}), set: async () => {} },
      local: { get: async () => ({}), set: async () => {} }
    },
    // Overlay origin granted, Plex origins declined.
    permissions: {
      contains: async () => true,
      request: async ({ origins }) => !origins.some(origin => origin.includes('plex'))
    },
    runtime: { sendMessage: async () => ({ success: true }) }
  };
  window.eval(fs.readFileSync('src/options/options.js', 'utf8'));
  for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve));

  window.document.getElementById('serverUrl').value = 'https://seerr.example';
  window.document.getElementById('plexToken').value = 'plex-token';
  window.document.getElementById('settingsForm').dispatchEvent(new window.Event('submit'));
  for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve));

  const text = window.document.querySelector('#status .status-text').textContent;
  assert.match(text, /Plex host permission was declined/);
});


test('flyout toasts stack in one column and cap bursts', () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<body></body>', { url: 'https://www.imdb.com/title/tt0111161/', runScripts: 'outside-only' });
  const { window } = dom;
  try {
    window.eval(fs.readFileSync('src/shared/UIComponents.js', 'utf8'));
    const ui = new window.UIComponents({ siteName: 'TEST' });
    // duration 0: no auto-remove timers, so the count is exact.
    for (let i = 1; i <= 6; i++) ui.createNotification('Title ' + i, 'Message ' + i, 'info', 0);
    const stack = window.document.querySelector('.seerr-notification-stack');
    assert.ok(stack, 'toasts share one stack container');
    assert.equal(stack.children.length, 4, 'a burst is capped instead of piling up');
    const titles = [...stack.children].map(note => note.querySelector('.seerr-notification-title').textContent);
    assert.deepEqual(titles, ['Title 3', 'Title 4', 'Title 5', 'Title 6']);
  } finally {
    dom.window.close();
  }
});
test('plex help text and buttons live on separate rows, not one flex line', () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(fs.readFileSync('src/options/options.html', 'utf8'),
    { url: 'chrome-extension://test/options.html' });
  const { document } = dom.window;
  try {
    const help = document.querySelector('small.plex-help');
    assert.ok(help, 'the plex hint has its own block');
    const [textRow, actionsRow] = [...help.children];
    assert.ok(textRow && textRow.tagName === 'SPAN' && /localStorage/.test(textRow.textContent));
    assert.ok(actionsRow && actionsRow.classList.contains('plex-help-actions'));
    assert.ok(actionsRow.querySelector('#togglePlexToken'), 'show toggle sits in the actions row');
    assert.ok(actionsRow.querySelector('#testPlexConnection'), 'test button sits in the actions row');
  } finally {
    dom.window.close();
  }
});

test('plexWatchlistState reports on, off, and unknown without throwing', async () => {
  const stateFor = userState => loadWorker({
    get: async () => ({}),
    local: { plexToken: 't' },
    fetch: async url => {
      const href = String(url);
      if (href.includes('/library/search')) {
        return jsonResponse(plexSearchJson([{ ratingKey: 'rk1', title: 'Dune', type: 'movie', year: 2021 }]));
      }
      if (href.includes('/library/metadata/rk1') && !href.includes('userState')) {
        return jsonResponse(plexDetailJson(438631));
      }
      if (href.includes('/userState')) return jsonResponse(userState);
      throw new Error(`unexpected ${href}`);
    }
  });
  const ask = (worker, data) => new Promise(resolve => worker.api.handleMessage({ action: 'plexWatchlistState', data }, {}, resolve));

  const workerOn = stateFor({ MediaContainer: { UserState: [{ watchlistedAt: 1700000000 }] } });
  await workerOn.ready;
  const onResult = await ask(workerOn, { title: 'Dune', mediaType: 'movie', tmdbId: 438631 });
  assert.equal(onResult.success, true);
  assert.equal(onResult.data.onWatchlist, true);

  const workerOff = stateFor({ MediaContainer: {} });
  await workerOff.ready;
  const offResult = await ask(workerOff, { title: 'Dune', mediaType: 'movie', tmdbId: 438631 });
  assert.equal(offResult.success, true);
  assert.equal(offResult.data.onWatchlist, false);

  const failing = loadWorker({
    get: async () => ({}),
    local: { plexToken: 't' },
    fetch: async () => { throw new TypeError('Failed to fetch'); }
  });
  await failing.ready;
  const unknownResult = await ask(failing, { title: 'Dune', mediaType: 'movie', tmdbId: 1 });
  assert.equal(unknownResult.success, true);
  assert.equal(unknownResult.data.unknown, true);

  const noToken = loadWorker({ get: async () => ({}), local: {} });
  await noToken.ready;
  const tokenless = await ask(noToken, { title: 'Dune', mediaType: 'movie', tmdbId: 1 });
  assert.equal(tokenless.data.unknown, true);
});

test('SeerrClient plexWatchlistState never throws', async () => {
  const SeerrClient = require('../src/shared/SeerrClient');
  const failing = new SeerrClient({ siteName: 'TEST' });
  failing.sendMessage = async () => { throw new Error('channel closed'); };
  assert.deepEqual(await failing.plexWatchlistState({ title: 'Dune', mediaType: 'movie', tmdbId: 1 }),
    { onWatchlist: false, unknown: true });

  const negative = new SeerrClient({ siteName: 'TEST' });
  negative.sendMessage = async () => ({ success: false, error: 'nope' });
  assert.deepEqual(await negative.plexWatchlistState({ title: 'Dune', mediaType: 'movie', tmdbId: 1 }),
    { onWatchlist: false, unknown: true });
});

test('flyout Plex button renders already-on-watchlist as disabled state', async () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<body></body>', { url: 'https://www.imdb.com/title/tt0111161/', runScripts: 'outside-only' });
  const { window } = dom;
  try {
    window.eval(fs.readFileSync('src/shared/UIComponents.js', 'utf8'));
    const ui = new window.UIComponents({ siteName: 'TEST' });
    const panel = window.document.createElement('div');
    const elements = ui.createFlyoutContent({ title: 'Dune', year: 2021, mediaType: 'movie' }, panel);
    const watching = { status: 'available_watch', buttonClass: 'watch', message: 'Available on Plex' };

    ui.updateFlyoutStatus(elements, watching, { plexConfigured: true, plexOnWatchlist: true });
    assert.equal(elements.plexButton.style.display, 'flex');
    assert.equal(elements.plexButton.querySelector('span').textContent, 'On Plex Watchlist ✓');
    assert.equal(elements.plexButton.disabled, true);

    ui.updateFlyoutStatus(elements, watching, { plexConfigured: true, plexOnWatchlist: false });
    assert.equal(elements.plexButton.querySelector('span').textContent, 'Add to Plex Watchlist');
    assert.equal(elements.plexButton.disabled, false);
  } finally {
    dom.window.close();
  }
});

// Seerr detail page: the Plex button resolves to already-on-watchlist state.
function openSeerrDetail({ watchlisted = true } = {}) {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<main><div class="detail-header"><h1>Dune (2021)</h1></div></main>',
    { url: 'https://seerr.example/movie/438631', runScripts: 'outside-only' });
  const { window } = dom;
  const messages = [];
  window.chrome = {
    storage: {
      sync: { get: async () => ({ seerrUrl: 'https://seerr.example' }) },
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      onChanged: { addListener() {} }
    },
    runtime: { sendMessage: async message => {
      messages.push(message);
      if (message.action === 'getConfigState') {
        return { success: true, data: { apiConfigured: false, serverUrl: 'https://seerr.example', plexConfigured: true } };
      }
      if (message.action === 'plexWatchlistState') {
        return { success: true, data: watchlisted
          ? { onWatchlist: true, ratingKey: 'rk9', title: 'Dune' }
          : { onWatchlist: false, ratingKey: 'rk9', title: 'Dune' } };
      }
      return { success: true, data: null };
    } }
  };
  window.fetch = async () => ({ ok: true, json: async () => ({ results: [] }) });
  for (const file of ['RatingsModel', 'RatingsConfig']) {
    window.eval(fs.readFileSync(`src/shared/${file}.js`, 'utf8'));
  }
  require('./helpers/overlay-modules').loadOverlayModules(window);
  window.eval(fs.readFileSync('src/content/seerr-integration.js', 'utf8').replace(/\}\)\(\);\s*$/, `window.testOverlay = {
    injectPlexWatchlistButton, detectRoute
  }; })();`));
  return { dom, window, messages };
}

test('detail button starts as already-on-watchlist when Plex says so', async t => {
  const fixture = openSeerrDetail({ watchlisted: true });
  t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.dom.window.close(); });
  for (let i = 0; i < 60; i++) await new Promise(resolve => setImmediate(resolve));
  fixture.window.testOverlay.injectPlexWatchlistButton();
  const button = fixture.window.document.querySelector('.seerr-plex-watchlist-button');
  assert.ok(button, 'button injects on the detail route');
  for (let i = 0; i < 60 && button.textContent !== '✓ On Plex Watchlist'; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(button.textContent, '✓ On Plex Watchlist');
  assert.equal(button.disabled, true);
  const checks = fixture.messages.filter(message => message.action === 'plexWatchlistState');
  assert.equal(checks.length, 1);
  assert.equal(checks[0].data.tmdbId, 438631);
});

test('detail button stays actionable when the title is not watchlisted', async t => {
  const fixture = openSeerrDetail({ watchlisted: false });
  t.after(() => { fixture.window.dispatchEvent(new fixture.window.Event('pagehide')); fixture.dom.window.close(); });
  for (let i = 0; i < 60; i++) await new Promise(resolve => setImmediate(resolve));
  fixture.window.testOverlay.injectPlexWatchlistButton();
  const button = fixture.window.document.querySelector('.seerr-plex-watchlist-button');
  assert.ok(button);
  for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(button.textContent, '＋ Add to Plex Watchlist');
  assert.equal(button.disabled, false);
});

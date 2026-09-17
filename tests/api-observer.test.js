// Seerr keeps a card's link, title and alt text inside a Transition that
// unmounts until the card is hovered, so an un-hovered card exposes only its
// poster. The observer forwards the lists Seerr already fetched so the overlay
// can identify those cards without waiting for a hover.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const CHANNEL = 'super-seerr:api';
const flush = () => new Promise(resolve => setImmediate(resolve));

function installObserver({ url = 'https://seerr.example/' } = {}) {
  const dom = new JSDOM('', { url, runScripts: 'outside-only' });
  const { window } = dom;
  const posted = [];
  window.postMessage = (message, origin) => posted.push({ message, origin });

  const fetched = [];
  window.fetch = async requested => {
    fetched.push(String(requested));
    const body = responses[String(requested)] ?? { results: [] };
    return { ok: true, clone: () => ({ json: async () => body }) };
  };
  const responses = {};

  window.eval(fs.readFileSync('src/content/seerr-api-observer.js', 'utf8'));
  return { dom, window, posted, fetched, respondWith: (u, body) => { responses[u] = body; } };
}

const itemsFrom = posted => posted.flatMap(entry => entry.message.items);

test('a discover response is forwarded with the fields a card needs', async () => {
  const ctx = installObserver();
  ctx.respondWith('/api/v1/discover/movies', {
    results: [{ id: 550, mediaType: 'movie', title: 'Fight Club', posterPath: '/abc.jpg', voteAverage: 8.4, releaseDate: '1999-10-15' }]
  });

  await ctx.window.fetch('/api/v1/discover/movies');
  await flush();

  assert.equal(ctx.posted.length, 1);
  assert.equal(ctx.posted[0].message.channel, CHANNEL);
  assert.equal(ctx.posted[0].origin, 'https://seerr.example', 'must be posted same-origin, never *');
  // Spread into a host object: the observer runs in the jsdom realm.
  assert.deepEqual({ ...ctx.posted[0].message.items[0] }, {
    id: 550, mediaType: 'movie', title: 'Fight Club', posterPath: '/abc.jpg', voteAverage: 8.4, releaseDate: '1999-10-15'
  });
});

test('account and settings endpoints are never observed', async () => {
  const ctx = installObserver();
  for (const endpoint of ['/api/v1/auth/me', '/api/v1/user/1', '/api/v1/settings/main', '/api/v1/settings/discover', '/api/v1/status']) {
    ctx.respondWith(endpoint, { results: [{ id: 1, email: 'someone@example.com', plexToken: 'secret' }] });
    await ctx.window.fetch(endpoint);
  }
  await flush();
  assert.equal(ctx.posted.length, 0, 'nothing about the account may cross the boundary');
});

test('only whitelisted fields are forwarded', async () => {
  const ctx = installObserver();
  ctx.respondWith('/api/v1/search?query=x', {
    results: [{ id: 550, title: 'Fight Club', plexUrl: 'https://plex.example/secret', email: 'me@example.com', overview: 'long text' }]
  });

  await ctx.window.fetch('/api/v1/search?query=x');
  await flush();

  const item = ctx.posted[0].message.items[0];
  assert.deepEqual(Object.keys(item).sort(), ['id', 'title']);
  assert.ok(!JSON.stringify(ctx.posted).includes('plex.example'));
  assert.ok(!JSON.stringify(ctx.posted).includes('me@example.com'));
});

test('a request list keeps the nested media identity', async () => {
  const ctx = installObserver();
  ctx.respondWith('/api/v1/request?take=20', {
    results: [{ id: 9, type: 'movie', media: { tmdbId: 550, mediaType: 'movie', posterPath: '/abc.jpg' } }]
  });

  await ctx.window.fetch('/api/v1/request?take=20');
  await flush();

  assert.equal(ctx.posted[0].message.items[0].media.tmdbId, 550);
  assert.equal(ctx.posted[0].message.items[0].media.posterPath, '/abc.jpg');
});

test('cross-origin and unrelated requests are ignored', async () => {
  const ctx = installObserver();
  // The third URL is the one that matters: its path looks exactly like a Seerr
  // API path, so only the origin check can reject it.
  const ignored = [
    'https://api.themoviedb.org/3/movie/550',
    '/static/chunk.js',
    'https://evil.example/api/v1/discover/movies'
  ];
  for (const url of ignored) {
    ctx.respondWith(url, { results: [{ id: 550, title: 'Injected', posterPath: '/x.jpg' }] });
    await ctx.window.fetch(url);
  }
  await flush();

  assert.equal(ctx.posted.length, 0, `nothing should be forwarded, saw ${JSON.stringify(ctx.posted)}`);
});

test('observing never disturbs the page', async () => {
  const ctx = installObserver();
  // A response the observer cannot read must still reach the caller intact.
  ctx.window.fetch = async () => { throw new Error('network down'); };
  ctx.window.eval(fs.readFileSync('src/content/seerr-api-observer.js', 'utf8'));
  await assert.rejects(ctx.window.fetch('/api/v1/discover/movies'), /network down/);

  const ctx2 = installObserver();
  ctx2.respondWith('/api/v1/discover/movies', { results: [{ id: 1 }] });
  const response = await ctx2.window.fetch('/api/v1/discover/movies');
  assert.equal(response.ok, true, 'the page still receives its own response');
});

test('the observer installs only once per page', () => {
  const ctx = installObserver();
  const patched = ctx.window.fetch;
  ctx.window.eval(fs.readFileSync('src/content/seerr-api-observer.js', 'utf8'));
  assert.equal(ctx.window.fetch, patched, 're-running must not double-wrap fetch');
});

test('a huge response is capped rather than forwarded whole', async () => {
  const ctx = installObserver();
  ctx.respondWith('/api/v1/discover/movies', {
    results: Array.from({ length: 5000 }, (_, i) => ({ id: i, title: `T${i}` }))
  });

  await ctx.window.fetch('/api/v1/discover/movies');
  await flush();

  assert.ok(itemsFrom(ctx.posted).length <= 200, `expected a cap, saw ${itemsFrom(ctx.posted).length}`);
});

test('every title-bearing Seerr endpoint is observed', async () => {
  // Mirrors Seerr's router: these all return title lists that render cards.
  const ctx = installObserver();
  const endpoints = [
    '/api/v1/discover/movies', '/api/v1/discover/tv', '/api/v1/discover/trending',
    '/api/v1/discover/watchlist', '/api/v1/search?query=x', '/api/v1/request?take=20',
    '/api/v1/media?filter=allavailable', '/api/v1/movie/550', '/api/v1/tv/1396',
    '/api/v1/collection/1241', '/api/v1/watchlist', '/api/v1/blocklist',
    '/api/v1/person/287/combined_credits'
  ];
  for (const endpoint of endpoints) {
    ctx.respondWith(endpoint, { results: [{ id: 550, title: 'X', posterPath: '/x.jpg' }] });
    await ctx.window.fetch(endpoint);
  }
  await flush();

  assert.equal(ctx.posted.length, endpoints.length, `expected all ${endpoints.length} observed`);
});

test('endpoints about people rather than titles stay excluded', async () => {
  const ctx = installObserver();
  // Issue threads carry user comments, so they are excluded despite naming media.
  for (const endpoint of ['/api/v1/issue', '/api/v1/issue/3', '/api/v1/issueComment/9']) {
    ctx.respondWith(endpoint, { results: [{ id: 1, title: 'X', comment: 'private text' }] });
    await ctx.window.fetch(endpoint);
  }
  await flush();
  assert.equal(ctx.posted.length, 0);
});

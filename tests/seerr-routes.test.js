// Seerr renders title cards on more pages than the overlay recognised. A route
// it does not recognise gets no badges and no sort or filter controls.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadOverlay } = require('./helpers/overlay');

// The overlay reads its configured server asynchronously, and serverPath()
// only strips a base path once that has landed. Without the tick these tests
// would pass on the raw pathname instead of the resolved one.
const tick = () => new Promise(resolve => setImmediate(resolve));
async function at(pathname, seerrUrl = 'https://seerr.example') {
  const overlay = loadOverlay({ pathname, settings: { seerrUrl } });
  await tick();
  return overlay;
}

test('the grid pages Seerr renders title cards on are all list routes', async () => {
  const gridPages = [
    '/',                       // discover home
    '/discover/movies',
    '/discover/tv',
    '/discover/trending',
    '/discover/watchlist',
    '/search',
    '/requests',
    '/collection/1241',        // the films in a collection
    '/person/287',             // that person's credits
    '/blocklist',              // added by Seerr
    '/profile/watchlist'
  ];
  for (const pathname of gridPages) {
    const overlay = await at(pathname);
    const route = overlay.detectRoute();
    assert.ok(route, `${pathname} should be recognised`);
    assert.equal(overlay.isListRoute(route), true, `${pathname} should be treated as a grid`);
  }
});

test('detail pages stay detail pages', async () => {
  for (const [pathname, type, id] of [['/movie/550', 'movie-detail', '550'], ['/tv/1396', 'tv-detail', '1396']]) {
    const overlay = await at(pathname);
    const route = overlay.detectRoute();
    assert.equal(route.type, type);
    assert.equal(route.id, id);
    assert.equal(overlay.isListRoute(route), false, 'a detail page is not a grid');
  }
});

test('pages with no title cards are still ignored', async () => {
  for (const pathname of ['/settings', '/settings/main', '/login', '/users', '/issues', '/profile/settings']) {
    assert.equal((await at(pathname)).detectRoute(), null, `${pathname} should not be recognised`);
  }
});

test('route detection fails closed when a page location is unavailable during teardown', async () => {
  const overlay = await at('/discover');
  Object.defineProperty(overlay.context.window, 'location', { configurable: true, get() { throw new Error('window closed'); } });
  assert.doesNotThrow(() => overlay.detectRoute());
  assert.equal(overlay.detectRoute(), null);
});

test('a collection and a person route carry their id', async () => {
  assert.deepEqual({ ...(await at('/collection/1241')).detectRoute() }, { type: 'collection', id: '1241' });
  assert.deepEqual({ ...(await at('/person/287')).detectRoute() }, { type: 'person', id: '287' });
});

test('the new routes work under a server base path', async () => {
  // A Seerr behind a reverse proxy at /seerr must behave the same.
  for (const pathname of ['/seerr/blocklist', '/seerr/collection/1241', '/seerr/profile/watchlist']) {
    const overlay = await at(pathname, 'https://seerr.example/seerr');
    const route = overlay.detectRoute();
    assert.ok(route, `${pathname} should be recognised behind a base path`);
    assert.equal(overlay.isListRoute(route), true);
  }
});

for (const base of ['', '/seerr']) {
  test(`route segments require complete names and positive safe IDs (${base || 'root'})`, async () => {
    const invalid = ['/searching', '/discovery', '/search-results', '/discoveries'];
    for (const family of ['movie', 'tv', 'collection', 'person']) {
      for (const id of ['0', '000550', '-1', '550junk', '550.5', '999999999999999999']) invalid.push(`/${family}/${id}`);
    }
    for (const path of invalid) {
      assert.equal((await at(`${base}${path}`, `https://seerr.example${base}`)).detectRoute(), null, path);
    }
  });

  test(`valid route segment boundaries preserve trailing slashes and nested pages (${base || 'root'})`, async () => {
    for (const [path, type, id] of [
      ['/movie/550/', 'movie-detail', '550'], ['/tv/1396/season/1', 'tv-detail', '1396'],
      ['/collection/1241/', 'collection', '1241'], ['/person/287/', 'person', '287'],
      ['/search/', 'search', undefined], ['/discover/movies', 'discover', undefined]
    ]) {
      const route = (await at(`${base}${path}`, `https://seerr.example${base}`)).detectRoute();
      assert.equal(route?.type, type, path);
      assert.equal(route?.id, id, path);
    }
  });
}

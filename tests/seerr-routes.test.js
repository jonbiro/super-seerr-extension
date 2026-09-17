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

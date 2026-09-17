// Some Seerr instances have no reachable IMDb source, so /ratingscombined 404s
// for every title. Asking once per card then costs a request and a red console
// line each, forever, for data that is never going to arrive.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Config = require('../src/shared/RatingsConfig');
const { loadOverlay } = require('./helpers/overlay');

// Four digits or more, so it is counted as a title under test.
const TMDB_ID = 5500;
const settings = { seerrUrl: 'https://seerr.example/' };

function overlayWithSeerr({ combinedFails = true } = {}) {
  const paths = [];
  const overlay = loadOverlay({
    settings,
    fetch: async url => {
      const { pathname } = new URL(String(url));
      paths.push(pathname);
      if (pathname.endsWith('/ratingscombined')) {
        return combinedFails ? { ok: false, status: 404 } : { ok: true, json: async () => ({ imdb: { criticsScore: 8.2 } }) };
      }
      return { ok: true, json: async () => ({ voteAverage: 7.9 }) };
    }
  });
  // Ids from 1000 up are the ones under test; the overlay also resolves its
  // own detail route on load, which must not be counted.
  const underTest = p => /\/movie\/[1-9]\d{3,}\//.test(p);
  return { overlay, combinedCalls: () => paths.filter(p => p.endsWith('/ratingscombined') && underTest(p)).length };
}

const lookUp = (overlay, n, from = 1000) =>
  Promise.all(Array.from({ length: n }, (_, i) => overlay.fetchSeerrSessionRatings(from + i, 'movie', null)));

test('a server that never has combined ratings stops being asked', async () => {
  const { overlay, combinedCalls } = overlayWithSeerr();
  const attempts = Config.seerrRatingsFailureLimit + 25;

  for (let i = 0; i < attempts; i++) await overlay.fetchSeerrSessionRatings(1000 + i, 'movie', null);

  assert.ok(combinedCalls() <= Config.seerrRatingsFailureLimit,
    `expected it to give up after ${Config.seerrRatingsFailureLimit}, made ${combinedCalls()} calls`);
  assert.ok(combinedCalls() > 0, 'it must try before giving up');
});

test('other endpoints keep working once it gives up', async () => {
  const { overlay } = overlayWithSeerr();
  for (let i = 0; i < Config.seerrRatingsFailureLimit + 5; i++) {
    await overlay.fetchSeerrSessionRatings(1000 + i, 'movie', null);
  }
  const bundle = await overlay.fetchSeerrSessionRatings(9999, 'movie', null);
  assert.equal(bundle.tmdbRating, 7.9, 'the detail endpoint is unaffected');
});

test('a single success keeps the endpoint in use', async () => {
  const { overlay, combinedCalls } = overlayWithSeerr({ combinedFails: false });
  const attempts = Config.seerrRatingsFailureLimit + 10;
  for (let i = 0; i < attempts; i++) await overlay.fetchSeerrSessionRatings(1000 + i, 'movie', null);
  assert.equal(combinedCalls(), attempts, 'a working server must never be given up on');
});

test('an intermittent server is not given up on', async () => {
  // Successes reset the count, so only a sustained run of failures counts.
  let call = 0;
  const paths = [];
  const overlay = loadOverlay({
    settings,
    fetch: async url => {
      const { pathname } = new URL(String(url));
      paths.push(pathname);
      if (!pathname.endsWith('/ratingscombined')) return { ok: true, json: async () => ({ voteAverage: 7.9 }) };
      // Fail a few, then succeed, repeatedly.
      return (++call % 4 === 0)
        ? { ok: true, json: async () => ({ imdb: { criticsScore: 8.2 } }) }
        : { ok: false, status: 404 };
    }
  });

  const attempts = Config.seerrRatingsFailureLimit * 3;
  for (let i = 0; i < attempts; i++) await overlay.fetchSeerrSessionRatings(1000 + i, 'movie', null);
  const forTitles = paths.filter(p => p.endsWith('/ratingscombined') && /\/movie\/[1-9]\d{3,}\//.test(p));
  assert.equal(forTitles.length, attempts, 'occasional success keeps it alive');
});

test('refreshing gives the endpoint another chance', async () => {
  const { overlay, combinedCalls } = overlayWithSeerr();
  for (let i = 0; i < Config.seerrRatingsFailureLimit + 5; i++) {
    await overlay.fetchSeerrSessionRatings(1000 + i, 'movie', null);
  }
  const gaveUpAt = combinedCalls();

  // Refresh is the user saying "try again".
  overlay.forgetRatings([{ tmdbId: TMDB_ID, mediaType: 'movie' }]);
  await overlay.fetchSeerrSessionRatings(TMDB_ID, 'movie', null);

  assert.equal(combinedCalls(), gaveUpAt + 1, 'a refresh should retry the endpoint');
});

test('diagnose reports that it gave up, rather than hiding it', async () => {
  const { overlay } = overlayWithSeerr();
  for (let i = 0; i < Config.seerrRatingsFailureLimit + 2; i++) {
    await overlay.fetchSeerrSessionRatings(1000 + i, 'movie', null);
  }
  const report = overlay.context.window.seerr_debug.ratings.diagnose();
  assert.equal(report.seerrRatings.givenUp.ratingscombined, true);
  assert.ok(report.seerrRatings.consecutiveFailures.ratingscombined >= Config.seerrRatingsFailureLimit);
});

test('giving up does not simply move the failures to the other endpoint', async () => {
  // The /ratings skip depended on /ratingscombined running first and 404ing.
  // Dropping combined from the list removed that signal, so every card then
  // asked /ratings instead: the same 404 per card under a different name.
  const paths = [];
  const overlay = loadOverlay({
    settings,
    fetch: async url => {
      const { pathname } = new URL(String(url));
      paths.push(pathname);
      if (pathname.endsWith('/ratings') || pathname.endsWith('/ratingscombined')) return { ok: false, status: 404 };
      return { ok: true, json: async () => ({ voteAverage: 7.9 }) };
    }
  });

  const attempts = Config.seerrRatingsFailureLimit * 3;
  for (let i = 0; i < attempts; i++) await overlay.fetchSeerrSessionRatings(1000 + i, 'movie', null);

  const forTitles = p => paths.filter(path => p.test(path) && /\/movie\/[1-9]\d{3,}/.test(path)).length;
  const asked = forTitles(/\/ratingscombined$/) + forTitles(/\/ratings$/);
  // A combined 404 means neither source exists, so /ratings cannot succeed
  // either. Allowing limit * 2 here would pass even if each endpoint counted
  // its own way to the limit separately, which is twice the requests.
  assert.ok(asked <= Config.seerrRatingsFailureLimit + 2,
    `both should stop once combined fails, saw ${asked} calls across ${attempts} titles`);
});

test('a server whose ratings work is never given up on', async () => {
  const paths = [];
  const overlay = loadOverlay({
    settings,
    fetch: async url => {
      const { pathname } = new URL(String(url));
      paths.push(pathname);
      if (pathname.endsWith('/ratingscombined')) return { ok: true, json: async () => ({ imdb: { criticsScore: 8.2 } }) };
      return { ok: true, json: async () => ({ voteAverage: 7.9 }) };
    }
  });

  const attempts = Config.seerrRatingsFailureLimit + 10;
  for (let i = 0; i < attempts; i++) await overlay.fetchSeerrSessionRatings(1000 + i, 'movie', null);
  const combined = paths.filter(p => p.endsWith('/ratingscombined') && /\/movie\/[1-9]\d{3,}/.test(p)).length;
  assert.equal(combined, attempts);
});

test('the detail endpoint keeps working after the ratings endpoints are dropped', async () => {
  const overlay = loadOverlay({
    settings,
    fetch: async url => String(url).match(/\/ratings/)
      ? { ok: false, status: 404 }
      : { ok: true, json: async () => ({ voteAverage: 7.9 }) }
  });
  for (let i = 0; i < Config.seerrRatingsFailureLimit + 5; i++) {
    await overlay.fetchSeerrSessionRatings(1000 + i, 'movie', null);
  }
  const bundle = await overlay.fetchSeerrSessionRatings(9999, 'movie', null);
  assert.equal(bundle.tmdbRating, 7.9, 'the TMDB rating still arrives');
});

test('a server with IMDb but no Rotten Tomatoes also stops being asked', async () => {
  // Seerr answers /ratingscombined with 200 when it has either source, so a
  // server holding IMDb but no RT returns 200 there and 404 from /ratings on
  // every card. Counting only the combined endpoint's failures would never
  // notice, because it always succeeds.
  const paths = [];
  const overlay = loadOverlay({
    settings,
    fetch: async url => {
      const { pathname } = new URL(String(url));
      paths.push(pathname);
      if (pathname.endsWith('/ratingscombined')) return { ok: true, json: async () => ({ imdb: { criticsScore: 8.2 } }) };
      if (pathname.endsWith('/ratings')) return { ok: false, status: 404 };
      return { ok: true, json: async () => ({ voteAverage: 7.9 }) };
    }
  });

  const attempts = Config.seerrRatingsFailureLimit * 3;
  for (let i = 0; i < attempts; i++) await overlay.fetchSeerrSessionRatings(1000 + i, 'movie', null);

  const plain = paths.filter(p => p.endsWith('/ratings') && /\/movie\/[1-9]\d{3,}/.test(p)).length;
  assert.ok(plain < attempts, `expected it to stop asking, saw ${plain} calls across ${attempts} titles`);
});

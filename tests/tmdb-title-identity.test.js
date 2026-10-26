const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker } = require('./helpers/worker');
const { receipt } = require('./helpers/request-receipt');

const CONFIGURED = { get: async () => ({ seerrUrl: 'https://seerr.example' }), local: { seerrApiKey: 'key' } };
const wanted = { title: 'Dune', year: 2021, mediaType: 'movie', tmdbId: 999 };

for (const year of [2021, null]) test(`a same-year unrelated detail title cannot corroborate a supplied TMDB id (page year: ${year})`, async () => {
  const { api, ready } = loadWorker(CONFIGURED); await ready;
  api.makeAPIRequest = async () => ({ id: 999, title: 'The Suicide Squad', releaseDate: '2021-08-05' });
  assert.equal(await api.tmdbIdentityMatches({ ...wanted, year }), false);
});

test('TV title identity checks both localized and original names', async () => {
  const { api, ready } = loadWorker(CONFIGURED); await ready;
  const media = { title: 'La casa de papel', year: 2017, mediaType: 'tv', tmdbId: 71446 };
  api.makeAPIRequest = async () => ({ id: 71446, name: 'Money Heist', originalName: 'La casa de papel', firstAirDate: '2017-05-02' });
  assert.equal(await api.tmdbIdentityMatches(media), true);
  api.makeAPIRequest = async () => ({ id: 71446, name: 'Dark', originalName: 'Dark', firstAirDate: '2017-12-01' });
  assert.equal(await api.tmdbIdentityMatches(media), false);
});

for (const method of ['requestMedia', 'addToWatchlist']) test(`${method} replaces an unrelated same-year page id with its unique verified match`, async () => {
  const { api, ready } = loadWorker(CONFIGURED); await ready;
  const posts = [];
  api.makeAPIRequest = async (verb, endpoint, data) => {
    if (verb === 'POST') { posts.push(data); return receipt(data, { id: 1 }); }
    if (endpoint === '/api/v1/movie/999') return { id: 999, title: 'The Suicide Squad', releaseDate: '2021-08-05' };
    throw new Error(`Unexpected ${verb} ${endpoint}`);
  };
  api.searchMedia = async () => [{ id: 438631, title: 'Dune', mediaType: 'movie', releaseDate: '2021-09-15' }];
  await api[method](wanted);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].mediaId ?? posts[0].tmdbId, 438631);
});

test('an unrelated same-year page id never authorizes a write when no match exists', async () => {
  const { api, ready } = loadWorker(CONFIGURED); await ready;
  let posts = 0;
  api.makeAPIRequest = async verb => {
    if (verb === 'POST') { posts++; return {}; }
    return { id: 999, title: 'The Suicide Squad', releaseDate: '2021-08-05' };
  };
  api.searchMedia = async () => [];
  await assert.rejects(api.requestMedia(wanted), /No unambiguous match/);
  await assert.rejects(api.addToWatchlist(wanted), /No unambiguous match/);
  assert.equal(posts, 0);
});

test('a saved title correction remains usable after fresh candidate and detail verification', async () => {
  const { api, ready } = loadWorker(CONFIGURED); await ready;
  const original = { title: 'Dune', year: 2021, mediaType: 'movie' };
  api.searchMedia = async () => [{ id: 438631, title: 'Dune', originalTitle: 'Dune', mediaType: 'movie', releaseDate: '2021-09-15' }];
  await api.saveTitleCorrection({ original, tmdbId: 438631 });
  const saved = await api.getSavedTitleCorrection(original);
  assert.equal(saved.tmdbId, 438631);
  const posts = [];
  api.makeAPIRequest = async (verb, endpoint, data) => {
    if (verb === 'POST') { posts.push(data); return receipt(data, { id: 1 }); }
    return { id: 438631, title: 'Dune', releaseDate: '2021-09-15' };
  };
  await api.requestMedia(saved);
  assert.equal(posts[0].mediaId, 438631);
});

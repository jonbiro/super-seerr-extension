const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker } = require('./helpers/worker');
const configured = { get: async () => ({ seerrUrl: 'https://seerr.example' }), local: { seerrApiKey: 'key' } };
const media = { title: 'Fight Club', year: 1999, mediaType: 'movie' };
const result = { id: 550, title: media.title, releaseDate: '1999-10-15', mediaType: 'movie' };

for (const [label, malformed] of [
  ['null', null], ['missing', undefined], ['missing results', {}],
  ['null results', { results: null }], ['object results', { results: {} }],
  ['text results', { results: '' }], ['bare array', []]
]) test(`${label} search response is retryable and cannot authorize a request`, async () => {
  const { api, ready } = loadWorker(configured); await ready;
  let response = malformed;
  let searches = 0;
  api.makeAPIRequest = async (method, endpoint) => {
    assert.equal(method, 'GET', 'invalid search evidence must never authorize a write');
    assert.match(endpoint, /\/api\/v1\/search\?/);
    searches++;
    return response;
  };
  api.getMediaDetails = async () => ({ status: 1 });
  const failed = await api.getMediaStatus(media);
  assert.equal(failed.status, 'error');
  assert.equal(failed.action, 'retryStatus');
  await assert.rejects(api.getMediaCandidates(media), /Search results unavailable/);
  await assert.rejects(api.requestMedia(media), /Search results unavailable/);
  response = { results: [result] };
  const recovered = await api.getMediaStatus(media);
  assert.equal(recovered.status, 'available');
  assert.equal(searches, 4, 'retry must issue a fresh search immediately');
});

test('stray invalid search rows do not hide a valid candidate or break a verified request', async () => {
  const { api, ready } = loadWorker(configured); await ready;
  const posts = [];
  api.makeAPIRequest = async (method, endpoint, body) => {
    if (method === 'POST') { posts.push(body); return { id: 42, type: 'movie', status: 1 }; }
    assert.match(endpoint, /\/api\/v1\/search\?/);
    return { results: [null, false, 'bad row', 7, [], result, { ...result, id: 1, mediaType: 'tv' }] };
  };
  const candidates = await api.getMediaCandidates(media);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].tmdbId, 550);
  assert.equal((await api.requestMedia(media)).tmdbId, 550);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].mediaId, 550);
});

test('a valid empty search remains unmatched rather than a transport error', async () => {
  const { api, ready } = loadWorker(configured); await ready;
  api.makeAPIRequest = async () => ({ results: [] });
  const status = await api.getMediaStatus(media);
  assert.equal(status.status, 'unmatched');
  assert.equal(status.action, 'choose');
});

for (const [field, value, title] of [
  ['title', ['Fight Club'], 'Fight Club'],
  ['originalTitle', ['Fight Club'], 'Fight Club'],
  ['name', ['Fight Club'], 'Fight Club'],
  ['originalName', ['Fight Club'], 'Fight Club'],
  ['title', 1984, '1984'],
  ['title', true, 'True']
]) test(`a coerced ${field} (${JSON.stringify(value)}) cannot authorize a request`, async () => {
  const { api, ready } = loadWorker(configured); await ready;
  const posts = [];
  api.makeAPIRequest = async (method, endpoint, body) => {
    if (method === 'POST') { posts.push(body); return { id: 42 }; }
    return { results: [{ id: 550, mediaType: 'movie', releaseDate: '1999-10-15', [field]: value }] };
  };
  const input = { ...media, title };
  assert.equal((await api.getMediaCandidates(input)).length, 0);
  await assert.rejects(api.requestMedia(input), /No unambiguous match/);
  assert.equal(posts.length, 0);
});

test('valid original-title evidence survives a malformed display title', async () => {
  const { api, ready } = loadWorker(configured); await ready;
  const posts = [];
  api.makeAPIRequest = async (method, endpoint, body) => {
    if (method === 'POST') { posts.push(body); return { id: 42 }; }
    return { results: [{ ...result, title: ['Wrong display'], originalTitle: media.title }] };
  };
  const candidates = await api.getMediaCandidates(media);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].title, media.title, 'picker must show a usable string title');
  assert.equal((await api.requestMedia(media)).tmdbId, 550);
  assert.equal(posts.length, 1);
});

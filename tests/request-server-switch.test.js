const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker } = require('./helpers/worker');
for (const field of ['baseUrl', 'apiKey']) {
  test(`request refuses a ${field} change during title verification`, async () => {
    const w = loadWorker({get:async () => ({seerrUrl:'https://seerr.example'}),local:{seerrApiKey:'old-key'}}); await w.ready;
    let finish, posts = 0;
    w.api.tmdbIdentityMatches = () => new Promise(resolve => {finish = resolve;});
    w.api.makeAPIRequest = async () => {posts++; return {id:1};};
    const pending = w.api.requestMedia({title:'Example',mediaType:'movie',tmdbId:1});
    w.api[field] = field === 'baseUrl' ? 'https://other.example' : 'new-key';
    finish(true);
    await assert.rejects(pending, /Settings changed/);
    assert.equal(posts, 0);
  });
}

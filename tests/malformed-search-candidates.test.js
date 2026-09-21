const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker } = require('./helpers/worker');
const valid = {id:550,title:'Fight Club',mediaType:'movie',releaseDate:'1999-10-15'};
for (const bad of [null, {title:'Fight Club',mediaType:'movie',releaseDate:'1999-10-15'}, {id:2,title:'Fight Club',mediaType:'movie',releaseDate:1999}]) {
  test(`malformed candidate ${JSON.stringify(bad)} cannot mask a valid match`, async () => {
    const worker = loadWorker({get:async () => ({seerrUrl:'https://seerr.example'}),local:{seerrApiKey:'key'}});
    await worker.ready;
    const matches = worker.api.matchingCandidates([bad,valid], {title:'Fight Club',mediaType:'movie',year:1999});
    assert.equal(matches.length, 1);
    assert.equal(matches[0].id, 550);
  });
}

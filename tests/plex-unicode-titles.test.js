const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker } = require('./helpers/worker');

for (const [title, candidate, matches] of [
  ['千と千尋の神隠し', '君の名は', false],
  ['千と千尋の神隠し', '千と千尋の神隠し', true],
  ['バトル', 'ハトル', false],
  ['バトル', 'ハ\u3099トル', true],
  ['Москва', 'Морозко', false],
  ['Москва', 'Москва', true],
  ['!!!', '???', false],
  ['Amélie', 'Amelie', true]
]) {
  test(`Plex title-only matching: ${title} / ${candidate}`, async () => {
    const worker = loadWorker({ local: { plexToken: 'test-token' } });
    await worker.ready;
    const writes = [];
    worker.api.plexFetch = async (_url, options) => {
      if (options.method === 'PUT') { writes.push(options.query.ratingKey); return null; }
      return { MediaContainer: { Metadata: [{ ratingKey: 'rk123', type: 'movie', title: candidate, year: 2001 }] } };
    };
    worker.api.plexUserState = async () => null;
    const adding = worker.api.plexAddToWatchlist({ title, mediaType: 'movie', year: 2001 });
    if (matches) {
      await adding;
      assert.deepEqual(writes, ['rk123']);
    } else {
      await assert.rejects(adding, /No Plex match/);
      assert.deepEqual(writes, []);
    }
  });
}

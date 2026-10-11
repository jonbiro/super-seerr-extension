const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker } = require('./helpers/worker');

for (const grouped of [false, true]) for (const mediaType of ['movie', 'tv']) {
  for (const [label, fields, matches] of [
    ['numeric year', { year: 2021 }, true],
    ['string year', { year: '2021' }, true],
    ['different numeric year', { year: 1984 }, false],
    ['different string year', { year: '1984' }, false],
    ['missing year', {}, false],
    ['array year', { year: [2021] }, false],
    ['release date', { originallyAvailableAt: '2021-10-22' }, true],
    ['malformed release date', { originallyAvailableAt: '2021garbage' }, false],
    ['impossible release date', { originallyAvailableAt: '2021-02-29' }, false]
  ]) {
    test(`Plex ${grouped ? 'grouped' : 'ungrouped'} ${mediaType} title-only lookup validates ${label}`, async () => {
      const worker = loadWorker({ local: { plexToken: 'test-token' } });
      await worker.ready;
      const metadata = { ratingKey: 'rk123', title: 'Dune', type: mediaType === 'tv' ? 'show' : 'movie', ...fields };
      const writes = [];
      worker.api.plexFetch = async (_url, options) => {
        if (options.method === 'PUT') { writes.push(options.query.ratingKey); return null; }
        return { MediaContainer: grouped
          ? { SearchResults: [{ id: 'external', SearchResult: [{ Metadata: metadata }] }] }
          : { Metadata: [metadata] } };
      };
      worker.api.plexUserState = async () => null;
      const adding = worker.api.plexAddToWatchlist({ title: 'Dune', mediaType, year: 2021 });
      if (matches) {
        await adding;
        assert.deepEqual(writes, ['rk123']);
      } else {
        await assert.rejects(adding, /No Plex match/);
        assert.deepEqual(writes, []);
      }
    });
  }
  test(`Plex ${grouped ? 'grouped' : 'ungrouped'} ${mediaType} lookup without a requested year accepts a unique title`, async () => {
    const worker = loadWorker({ local: { plexToken: 'test-token' } });
    await worker.ready;
    const metadata = { ratingKey: 'rk123', title: 'Dune', type: mediaType === 'tv' ? 'show' : 'movie' };
    const writes = [];
    worker.api.plexFetch = async (_url, options) => {
      if (options.method === 'PUT') { writes.push(options.query.ratingKey); return null; }
      return { MediaContainer: grouped
        ? { SearchResults: [{ id: 'external', SearchResult: [{ Metadata: metadata }] }] }
        : { Metadata: [metadata] } };
    };
    worker.api.plexUserState = async () => null;
    await worker.api.plexAddToWatchlist({ title: 'Dune', mediaType });
    assert.deepEqual(writes, ['rk123']);
  });
}

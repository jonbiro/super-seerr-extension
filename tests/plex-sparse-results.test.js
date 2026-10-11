const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker } = require('./helpers/worker');

for (const mediaType of ['movie', 'tv']) for (const grouped of [false, true]) {
  for (const placement of ['before', 'after', 'both', 'only']) {
    test(`Plex ${mediaType} ${grouped ? 'grouped' : 'ungrouped'} search handles null results (${placement})`, async () => {
      const worker = loadWorker({ local: { plexToken: 'test-token' } });
      await worker.ready;
      const valid = { ratingKey: 'valid1', title: 'Dune', type: mediaType === 'tv' ? 'show' : 'movie', year: 2021 };
      const results = placement === 'before' ? [null, valid] : placement === 'after' ? [valid, null]
        : placement === 'both' ? [null, valid, null] : [null];
      const writes = [];
      worker.api.plexFetch = async (url, options) => {
        if (options.method === 'PUT') { writes.push(options.query.ratingKey); return null; }
        if (url.endsWith('/library/search')) return { MediaContainer: grouped
          ? { SearchResults: [{ id: 'external', SearchResult: results.map(Metadata => ({ Metadata })) }] }
          : { Metadata: results } };
        return { MediaContainer: { Metadata: [{ Guid: [{ id: 'tmdb://123' }] }] } };
      };
      worker.api.plexUserState = async () => null;
      const adding = worker.api.plexAddToWatchlist({ title: 'Dune', mediaType, tmdbId: 123, year: 2021 });
      if (placement === 'only') {
        await assert.rejects(adding, /No Plex match/);
        assert.deepEqual(writes, []);
      } else {
        assert.equal((await adding).ratingKey, 'valid1');
        assert.deepEqual(writes, ['valid1']);
      }
    });
  }
}

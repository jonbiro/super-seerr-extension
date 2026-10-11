const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker } = require('./helpers/worker');

for (const mediaType of ['movie', 'tv']) for (const includeValid of [false, true]) {
  for (const [label, badId] of [
    ['suffix', 'tmdb://123garbage'],
    ['path', 'tmdb://123/456'],
    ['query', 'tmdb://123?other=456'],
    ['fragment', 'tmdb://123#456'],
    ['line break', 'tmdb://123\n'],
    ['array', ['tmdb://123']]
  ]) {
    test(`Plex ${mediaType} ignores a ${label} GUID (valid fallback: ${includeValid})`, async () => {
      const worker = loadWorker({ local: { plexToken: 'test-token' } });
      await worker.ready;
      const writes = [];
      worker.api.plexFetch = async (url, options) => {
        if (options.method === 'PUT') { writes.push(options.query.ratingKey); return null; }
        if (url.endsWith('/library/search')) {
          return { MediaContainer: { Metadata: ['wrong1', ...(includeValid ? ['right1'] : [])].map(ratingKey => ({
            ratingKey, title: 'Dune', type: mediaType === 'tv' ? 'show' : 'movie'
          })) } };
        }
        return { MediaContainer: { Metadata: [{ Guid: [{ id: url.endsWith('/right1') ? 'TMDB://123' : badId }] }] } };
      };
      worker.api.plexUserState = async () => null;
      const adding = worker.api.plexAddToWatchlist({ title: 'Dune', mediaType, tmdbId: 123 });
      if (includeValid) {
        const result = await adding;
        assert.equal(result.ratingKey, 'right1');
        assert.deepEqual(writes, ['right1']);
      } else {
        await assert.rejects(adding, /No Plex match for TMDB 123/);
        assert.deepEqual(writes, []);
      }
    });
  }
}

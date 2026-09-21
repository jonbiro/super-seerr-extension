// Property test 11: tmdbId round-trips through createMediaData (Requirement 14)
const { test } = require('node:test');
const assert = require('node:assert');
const fc = require('fast-check');

const MediaExtractor = require('../src/shared/MediaExtractor');
const extractor = new MediaExtractor();
const createMediaData = (data, source) => extractor.createMediaData(data, source);

test('Property 11: tmdbId round-trips through createMediaData', () => {
  fc.assert(
    fc.property(
      fc.record({
        imdbId: fc.oneof(fc.constant(null), fc.string({ minLength: 5 })),
        title: fc.string({ minLength: 1 }),
        year: fc.oneof(fc.constant(null), fc.integer({ min: 1900, max: 2030 })),
        mediaType: fc.oneof(fc.constant('movie'), fc.constant('tv')),
        posterUrl: fc.oneof(fc.constant(null), fc.webUrl()),
        overview: fc.oneof(fc.constant(null), fc.string({ minLength: 1 })),
        tmdbId: fc.oneof(fc.constant(null), fc.constant(undefined), fc.integer({ min: 1 }))
      }),
      fc.string({ minLength: 1 }),
      (rawData, source) => {
        const result = createMediaData(rawData, source);

        if (rawData.tmdbId != null) {
          assert.strictEqual(result.tmdbId, rawData.tmdbId,
            `When rawData.tmdbId is ${rawData.tmdbId}, result.tmdbId should be ${rawData.tmdbId}`);
        } else {
          assert.strictEqual(result.tmdbId, null,
            `When rawData.tmdbId is ${rawData.tmdbId}, result.tmdbId should be null`);
        }

        // Other fields should still work
        assert.strictEqual(result.title, rawData.title);
        assert.strictEqual(result.source, source);
      }
    )
  );
});

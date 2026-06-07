// Property test 12: Ratings bundle is always renderable
// regardless of which fields are null (all 16 combinations)
const { test } = require('node:test');
const assert = require('node:assert');
const fc = require('fast-check');
const { createRatingsBundle, hasAnyScore } = require('../src/shared/RatingsModel');

test('Property 12: Ratings bundle is always renderable', () => {
  fc.assert(
    fc.property(
      fc.record({
        rtCriticsScore:  fc.oneof(fc.constant(null), fc.integer({ min: 0, max: 100 })),
        rtAudienceScore: fc.oneof(fc.constant(null), fc.integer({ min: 0, max: 100 })),
        imdbRating:      fc.oneof(fc.constant(null), fc.float({ min: 0, max: 10 })),
        tmdbRating:      fc.oneof(fc.constant(null), fc.float({ min: 0, max: 10 })),
      }),
      (partial) => {
        const bundle = createRatingsBundle(partial);

        // Bundle must never throw during creation
        assert.strictEqual(bundle.rtCriticsScore, partial.rtCriticsScore ?? null);
        assert.strictEqual(bundle.rtAudienceScore, partial.rtAudienceScore ?? null);
        assert.strictEqual(bundle.imdbRating, partial.imdbRating ?? null);
        assert.strictEqual(bundle.tmdbRating, partial.tmdbRating ?? null);

        // hasAnyScore must never throw
        const hasAny = hasAnyScore(bundle);
        assert.strictEqual(typeof hasAny, 'boolean');

        // Default values
        assert.strictEqual(typeof bundle.confidence, 'number');
        assert.strictEqual(typeof bundle.source, 'string');
      }
    )
  );
});

test('hasAnyScore returns true when any score is present', () => {
  assert.strictEqual(hasAnyScore(createRatingsBundle({ rtCriticsScore: 84 })), true);
  assert.strictEqual(hasAnyScore(createRatingsBundle({ imdbRating: 7.5 })), true);
  assert.strictEqual(hasAnyScore(createRatingsBundle({})), false);
  assert.strictEqual(hasAnyScore(createRatingsBundle({ rtCriticsScore: null, rtAudienceScore: null, imdbRating: null, tmdbRating: null })), false);
});

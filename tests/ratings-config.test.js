// Property test 14: Summary heuristic is total
// Every (criticsScore, audienceScore) pair produces exactly one label or null
const { test } = require('node:test');
const assert = require('node:assert');
const fc = require('fast-check');

const { loadOverlay } = require('./helpers/overlay');
const { buildSummary } = loadOverlay();

const VALID_LABELS = new Set([
  'Audience loves it even more than critics',
  'Critics love it',
  'Strong reviews',
  'Mixed reviews',
  'Audience likes it more than critics',
  'Mostly negative reviews',
]);

test('Property 14: Summary heuristic returns exactly one valid label or null', () => {
  fc.assert(
    fc.property(
      fc.oneof(
        fc.constant(null),
        fc.integer({ min: 0, max: 100 })
      ),
      fc.oneof(
        fc.constant(null),
        fc.integer({ min: 0, max: 100 })
      ),
      (criticsScore, audienceScore) => {
        const result = buildSummary({ confidence: 1, rtCriticsScore: criticsScore, rtAudienceScore: audienceScore });

        if (criticsScore === null) {
          assert.strictEqual(result, null, 'Null critics score should return null');
        } else {
          assert.ok(result !== undefined, 'Result should not be undefined');
          assert.ok(result !== null, 'Non-null critics score should return a non-null string');
          assert.ok(VALID_LABELS.has(result), `Result "${result}" should be a valid label`);
        }
      }
    )
  );
});

test('0% RT critics score is treated as valid (not absent)', () => {
  const result = buildSummary({ confidence: 1, rtCriticsScore: 0, rtAudienceScore: null });
  assert.strictEqual(result, 'Mostly negative reviews');

  const result2 = buildSummary({ confidence: 1, rtCriticsScore: 0, rtAudienceScore: 50 });
  assert.strictEqual(result2, 'Audience likes it more than critics');
});

test('uncertain matches never receive a review summary', () => {
  assert.equal(buildSummary({ confidence: 0.2, rtCriticsScore: 90, rtAudienceScore: 90 }), null);
});

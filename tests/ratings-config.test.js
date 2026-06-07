// Property test 14: Summary heuristic is total
// Every (criticsScore, audienceScore) pair produces exactly one label or null
const { test } = require('node:test');
const assert = require('node:assert');
const fc = require('fast-check');

// buildSummary logic replicated from seerr-integration.js
const RatingsConfig = {
  summary: {
    criticsCertifiedFresh: 75,
    criticsStrong: 60,
    criticsMixed: 40,
  },
  audienceCriticsDelta: 15,
};

function buildSummary(bundle) {
  const c = bundle.rtCriticsScore;
  const a = bundle.rtAudienceScore;
  if (c === null) return null;

  const cfg = RatingsConfig.summary;
  if (c >= cfg.criticsCertifiedFresh) {
    if (a !== null && a - c >= RatingsConfig.audienceCriticsDelta) {
      return 'Audience loves it even more than critics';
    }
    return 'Critics love it';
  }
  if (c >= cfg.criticsStrong)  return 'Strong reviews';
  if (c >= cfg.criticsMixed)   return 'Mixed reviews';
  if (a !== null && a - c >= RatingsConfig.audienceCriticsDelta) {
    return 'Audience likes it more than critics';
  }
  return 'Mostly negative reviews';
}

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
        const result = buildSummary({ rtCriticsScore: criticsScore, rtAudienceScore: audienceScore });

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
  const result = buildSummary({ rtCriticsScore: 0, rtAudienceScore: null });
  assert.strictEqual(result, 'Mostly negative reviews');

  const result2 = buildSummary({ rtCriticsScore: 0, rtAudienceScore: 50 });
  assert.strictEqual(result2, 'Audience likes it more than critics');
});

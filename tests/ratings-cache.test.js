// Property test 13: Session cache coalescing
// Never issues more than one concurrent request per TMDB ID
const { test } = require('node:test');
const assert = require('node:assert');

test('Property 13: Session cache coalesces concurrent requests', async () => {
  // Simulate the cache + coalescing logic
  const cache = new Map();
  let requestCount = 0;

  async function resolveRatings(tmdbId) {
    requestCount++;
    await new Promise(r => setTimeout(r, 50)); // simulate network
    return { rtCriticsScore: 84, confidence: 1.0 };
  }

  async function getRatings(tmdbId) {
    const key = String(tmdbId);
    const cached = cache.get(key);
    if (cached) return cached;

    const pendingKey = `pending:${key}`;
    if (cache.has(pendingKey)) {
      return cache.get(pendingKey);
    }

    const promise = resolveRatings(tmdbId);
    cache.set(pendingKey, promise);

    const bundle = await promise;
    cache.delete(pendingKey);
    cache.set(key, bundle);
    return bundle;
  }

  // Fire N concurrent requests for the same TMDB ID
  const promises = Array.from({ length: 10 }, () => getRatings(12345));
  const results = await Promise.all(promises);

  // All 10 callers should get the same result
  results.forEach(r => {
    assert.strictEqual(r.rtCriticsScore, 84);
  });

  // Only 1 network request should have been issued
  assert.strictEqual(requestCount, 1, 'Only one network request should be issued for concurrent lookups');
});

test('Property 13b: Different TMDB IDs issue separate requests', async () => {
  const cache = new Map();
  let requestCount = 0;

  async function resolveRatings(tmdbId) {
    requestCount++;
    await new Promise(r => setTimeout(r, 20));
    return { rtCriticsScore: tmdbId === 1 ? 90 : 70, confidence: 1.0 };
  }

  async function getRatings(tmdbId) {
    const key = String(tmdbId);
    const cached = cache.get(key);
    if (cached) return cached;

    const pendingKey = `pending:${key}`;
    if (cache.has(pendingKey)) return cache.get(pendingKey);

    const promise = resolveRatings(tmdbId);
    cache.set(pendingKey, promise);
    const bundle = await promise;
    cache.delete(pendingKey);
    cache.set(key, bundle);
    return bundle;
  }

  const [r1, r2] = await Promise.all([getRatings(1), getRatings(2)]);
  assert.strictEqual(r1.rtCriticsScore, 90);
  assert.strictEqual(r2.rtCriticsScore, 70);
  assert.strictEqual(requestCount, 2, 'Different TMDB IDs should issue separate requests');
});

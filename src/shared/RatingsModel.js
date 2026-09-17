// Shared Ratings Bundle
// All overlay consumers use this model. Partial bundles (some fields null) are valid.

function createRatingsBundle(partial = {}) {
  partial = partial && typeof partial === 'object' ? partial : {};
  const score = (value, max) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : null;
  return {
    rtCriticsScore:  score(partial.rtCriticsScore, 100),  // 0–100 integer or null
    rtAudienceScore: score(partial.rtAudienceScore, 100),  // 0–100 integer or null
    imdbRating:      score(partial.imdbRating, 10),  // 0.0–10.0 float or null
    tmdbRating:      score(partial.tmdbRating, 10),  // 0.0–10.0 float or null
    confidence:      score(partial.confidence, 1) ?? 0,     // 0–1 float
    source:          partial.source          ?? 'unknown',
    lastUpdated:     partial.lastUpdated     ?? null
  };
}

function hasAnyScore(bundle) {
  if (!bundle || typeof bundle !== 'object') return false;
  return ['rtCriticsScore', 'rtAudienceScore', 'imdbRating', 'tmdbRating'].some(key =>
    typeof bundle[key] === 'number' && Number.isFinite(bundle[key]));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createRatingsBundle, hasAnyScore };
} else if (typeof window !== 'undefined') {
  window.RatingsModel = { createRatingsBundle, hasAnyScore };
}

// Shared Ratings Bundle
// All overlay consumers use this model. Partial bundles (some fields null) are valid.

function createRatingsBundle(partial = {}) {
  return {
    rtCriticsScore:  partial.rtCriticsScore  ?? null,  // 0–100 integer or null
    rtAudienceScore: partial.rtAudienceScore ?? null,  // 0–100 integer or null
    imdbRating:      partial.imdbRating      ?? null,  // 0.0–10.0 float or null
    tmdbRating:      partial.tmdbRating      ?? null,  // 0.0–10.0 float or null
    confidence:      partial.confidence      ?? 0,     // 0–1 float
    source:          partial.source          ?? 'unknown',
    lastUpdated:     partial.lastUpdated     ?? null
  };
}

function hasAnyScore(bundle) {
  return bundle.rtCriticsScore !== null ||
         bundle.rtAudienceScore !== null ||
         bundle.imdbRating !== null ||
         bundle.tmdbRating !== null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createRatingsBundle, hasAnyScore };
} else if (typeof window !== 'undefined') {
  window.RatingsModel = { createRatingsBundle, hasAnyScore };
}

// Centralised thresholds and summary rules.
// All numeric values are in the same unit as the relevant score (0–100 for RT, 0–10 for IMDb/TMDB).

const RatingsConfig = {
  // Minimum confidence to render an RT score at all
  confidenceThreshold: 0.7,

  // Thresholds for quality summary heuristics (RT critics %)
  summary: {
    criticsCertifiedFresh: 75,   // "Critics love it"
    criticsStrong:         60,   // "Strong reviews"
    criticsMixed:          40,   // "Mixed reviews"
    // Below 40 → "Mostly negative reviews"
  },

  // Audience vs critics delta for the "Audience disagrees" summary
  audienceCriticsDelta: 15,  // e.g. audience 80, critics 60 → "Audience likes it more"

  // Session cache TTL in milliseconds (5 minutes)
  cacheTtlMs: 5 * 60 * 1000,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = RatingsConfig;
} else if (typeof window !== 'undefined') {
  window.RatingsConfig = RatingsConfig;
}

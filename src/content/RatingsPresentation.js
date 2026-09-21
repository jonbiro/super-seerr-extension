// Pure score parsing, merging, and user-facing summaries.
(function (root) {
  root.createRatingsPresentation = function ({ Model, Config }) {
    function parseScore(value, max) {
      if (typeof value !== 'number' && typeof value !== 'string') return null;
      if (typeof value === 'string' && !value.trim()) return null;
      const number = typeof value === 'number' ? value : Number(value.trim().replace(/%$/, ''));
      return Number.isFinite(number) && number >= 0 && number <= max ? number : null;
    }

    function parsePercentScore(value) {
      const score = parseScore(value, 100);
      return score === null ? null : Math.round(score);
    }

    // TMDB and IMDb both report 0 for a title nobody has rated, and neither
    // scale can otherwise reach 0 — their votes start at 1. So a zero here means
    // "no rating", and showing it as 0/10 would read as a damning score and sort
    // below genuine low ratings. A Rotten Tomatoes 0% is a real verdict and is
    // handled by parsePercentScore, which keeps it.
    function parseTenPointScore(value) {
      const score = parseScore(value, 10);
      if (score === null || score === 0) return null;
      return Math.round(score * 10) / 10;
    }

    function firstParsedScore(obj, keys, parser) {
      for (const key of keys) {
        if (obj && Object.prototype.hasOwnProperty.call(obj, key)) {
          const parsed = parser(obj[key]);
          if (parsed !== null) return parsed;
        }
      }
      return null;
    }

    function bundleFromRatingObject(obj, source = 'seerr-native') {
      if (!obj || typeof obj !== 'object') return null;

      const bundle = {};
      const rt = obj.rt || obj.rottenTomatoes || obj.rottenTomatoesRatings || {};
      const imdb = obj.imdb || obj.imdbRatings || {};
      const mediaInfo = obj.mediaInfo || obj.media || {};

      const critics = firstParsedScore(obj, ['rtCriticsScore', 'rtScore', 'criticsScore', 'criticScore', 'tomatometerScore'], parsePercentScore)
        ?? firstParsedScore(rt, ['rtCriticsScore', 'rtScore', 'criticsScore', 'criticScore', 'tomatometerScore'], parsePercentScore);
      const audience = firstParsedScore(obj, ['rtAudienceScore', 'audienceScore', 'audienceRatingScore', 'popcornScore'], parsePercentScore)
        ?? firstParsedScore(rt, ['rtAudienceScore', 'audienceScore', 'audienceRatingScore', 'popcornScore'], parsePercentScore);
      const imdbRating = firstParsedScore(obj, ['imdbRating', 'imdbScore'], parseTenPointScore)
        ?? firstParsedScore(imdb, ['imdbRating', 'imdbScore', 'criticsScore', 'score'], parseTenPointScore);
      const tmdbRating = firstParsedScore(obj, ['tmdbRating', 'tmdbScore', 'voteAverage'], parseTenPointScore)
        ?? firstParsedScore(mediaInfo, ['tmdbRating', 'tmdbScore', 'voteAverage'], parseTenPointScore);

      if (critics !== null) bundle.rtCriticsScore = critics;
      if (audience !== null) bundle.rtAudienceScore = audience;
      if (imdbRating !== null) bundle.imdbRating = imdbRating;
      if (tmdbRating !== null) bundle.tmdbRating = tmdbRating;

      if (Object.keys(bundle).length === 0) return null;
      return Model.createRatingsBundle({
        ...bundle,
        confidence: 1.0,
        source,
        lastUpdated: Date.now()
      });
    }

    const SCORE_FIELDS = ['rtCriticsScore', 'rtAudienceScore', 'imdbRating', 'tmdbRating'];

    // A bundle no further source can improve; nothing left to fill in.
    function isBundleComplete(bundle) {
      return !!bundle && SCORE_FIELDS.every(field => bundle[field] !== null);
    }

    function mergeBundles(primary, secondary) {
      if (!primary) return secondary || null;
      if (!secondary) return primary;
      // Confidence belongs to the RT fields actually retained. A trusted TMDB
      // rating must not turn an approximate RT title match into a certain one.
      const rtSources = [];
      for (const field of ['rtCriticsScore', 'rtAudienceScore']) {
        if (primary[field] !== null) rtSources.push(primary);
        else if (secondary[field] !== null) rtSources.push(secondary);
      }
      return Model.createRatingsBundle({
        rtCriticsScore: primary.rtCriticsScore ?? secondary.rtCriticsScore,
        rtAudienceScore: primary.rtAudienceScore ?? secondary.rtAudienceScore,
        imdbRating: primary.imdbRating ?? secondary.imdbRating,
        tmdbRating: primary.tmdbRating ?? secondary.tmdbRating,
        confidence: rtSources.length
          ? Math.min(...rtSources.map(bundle => bundle.confidence || 0))
          : Math.max(primary.confidence || 0, secondary.confidence || 0),
        source: primary.source || secondary.source,
        lastUpdated: Math.max(primary.lastUpdated || 0, secondary.lastUpdated || 0) || Date.now()
      });
    }


    function buildSummary(bundle) {
      if (bundle.confidence < Config.confidenceThreshold) return null;
      const c = bundle.rtCriticsScore;
      const a = bundle.rtAudienceScore;
      if (c === null) return null;

      const cfg = Config.summary;
      if (c >= cfg.criticsCertifiedFresh) {
        if (a !== null && a - c >= Config.audienceCriticsDelta) {
          return 'Audience loves it even more than critics';
        }
        return 'Critics love it';
      }
      if (c >= cfg.criticsStrong)  return 'Strong reviews';
      if (c >= cfg.criticsMixed)   return 'Mixed reviews';
      if (a !== null && a - c >= Config.audienceCriticsDelta) {
        return 'Audience likes it more than critics';
      }
      return 'Mostly negative reviews';
    }
    return { parsePercentScore, parseTenPointScore, bundleFromRatingObject, isBundleComplete, mergeBundles, buildSummary };
  };
})(typeof window !== 'undefined' ? window : globalThis);

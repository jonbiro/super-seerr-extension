// Session-authenticated Seerr reads and per-title ratings resolution.
(function (root) {
  root.createSeerrSession = function ({ Config, Model, log, getServer, bundleFromRatingObject, mergeBundles, isBundleComplete }) {
    async function fetchJsonFromSeerr(endpoint) {
      const basePath = getServer()?.pathname.replace(/\/+$/, '') || '';
      const url = new URL(`${basePath}${endpoint}`, window.location.origin);
      const response = await fetch(url.toString(), {
        method: 'GET',
        signal: AbortSignal.timeout(Config.requestTimeoutMs),
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });

      if (!response.ok) {
        log(`Seerr ratings endpoint ${endpoint} returned ${response.status}`);
        return { ok: false, status: response.status, data: null };
      }

      return { ok: true, status: response.status, data: await response.json() };
    }

    // What each endpoint can contribute. Asking one whose fields are all known
    // spends a request to learn nothing, and on a grid that is once per card.
    const SESSION_ENDPOINT_FIELDS = {
      ratingscombined: ['rtCriticsScore', 'rtAudienceScore', 'imdbRating'],
      ratings: ['rtCriticsScore', 'rtAudienceScore'],
      detail: ['tmdbRating']
    };

    // A 404 describes this title, not endpoint availability. Never suppress
    // unrelated movies or shows after a run of missing ratings.
    const seerrRatingsRequests = { ratings: 0, ratingscombined: 0 };
    let generation = 0;
    let ratingsAvailabilityReady = null;

    function loadRatingsAvailability() {
      // Retire legacy server-wide verdicts from older extension versions.
      ratingsAvailabilityReady ??= chrome.storage.local.remove(['seerrRatingsUnavailableV1'])
        .catch(error => log('Could not remove legacy ratings verdict:', error));
      return ratingsAvailabilityReady;
    }

    function resetSeerrRatings() {
      generation++;
      ratingsAvailabilityReady = null;
      void loadRatingsAvailability();
    }

    function endpointCanHelp(bundle, fields) {
      return !bundle || fields.some(field => bundle[field] === null || bundle[field] === undefined);
    }

    async function fetchSeerrSessionRatings(tmdbId, mediaType, known = null, outcome = {}) {
      if (!tmdbId || !mediaType) return null;
      const expected = generation;

      const all = mediaType === 'tv'
        ? [[`/api/v1/tv/${tmdbId}/ratings`, 'ratings'], [`/api/v1/tv/${tmdbId}`, 'detail']]
        : [[`/api/v1/movie/${tmdbId}/ratingscombined`, 'ratingscombined'],
           [`/api/v1/movie/${tmdbId}/ratings`, 'ratings'],
           [`/api/v1/movie/${tmdbId}`, 'detail']];
      const endpoints = all
        .filter(([, kind]) => endpointCanHelp(known, SESSION_ENDPOINT_FIELDS[kind]))
        .map(([endpoint]) => endpoint);

      let bundle = null;
      let ratingsAreAbsent = false;
      for (const endpoint of endpoints) {
        // Seerr answers /ratingscombined with 404 only when it has neither RT
        // nor IMDb, and /ratings with 404 when it has no RT. So once combined
        // has 404ed, /ratings cannot succeed; asking is a guaranteed second
        // failure and a second red line in the page console.
        if (ratingsAreAbsent && endpoint.endsWith('/ratings')) {
          log(`Skipping ${endpoint}; the combined endpoint already reported no ratings`);
          continue;
        }
        try {
          const kind = endpoint.endsWith('/ratingscombined') ? 'ratingscombined'
            : endpoint.endsWith('/ratings') ? 'ratings' : null;
          if (kind) seerrRatingsRequests[kind]++;
          const result = await fetchJsonFromSeerr(endpoint);
          if (expected !== generation) { outcome.conclusive = false; return null; }
          if (!result.ok) {
            if (result.status === 404 && endpoint.endsWith('/ratingscombined')) ratingsAreAbsent = true;
            // 404 is Seerr saying it has nothing. A 500 or a 401 is Seerr failing
            // to say anything, and must not be recorded as "this title is unrated".
            else if (result.status !== 404) outcome.conclusive = false;
            continue;
          }
          const next = bundleFromRatingObject(result.data, endpoint.includes('ratings') ? 'seerr-ratings-api' : 'seerr-details-api');
          bundle = mergeBundles(bundle, next);
        } catch (error) {
          // A 404 is Seerr answering; a throw means we never got an answer.
          outcome.conclusive = false;
          log(`Seerr ratings fetch failed for ${endpoint}:`, error);
        }
        // These run once per card. Walking the remaining endpoints when there is
        // nothing left to fill multiplies load on a self-hosted server for free.
        if (isBundleComplete(bundle)) {
          log(`Seerr ratings complete after ${endpoint}; skipping remaining endpoints`);
          break;
        }
      }

      return bundle && Model.hasAnyScore(bundle) ? bundle : null;
    }

    return { fetchJsonFromSeerr, loadRatingsAvailability, resetSeerrRatings, fetchSeerrSessionRatings, seerrRatingsRequests };
  };
})(typeof window !== 'undefined' ? window : globalThis);

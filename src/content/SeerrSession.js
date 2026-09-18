// Session-authenticated Seerr reads and ratings endpoint circuit breakers.
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

    // Seerr serves /ratings and /ratingscombined from one backend, so where that
    // is unreachable both 404 for every title, costing a request and a console
    // error apiece for data that will not arrive. They are given up on together:
    // dropping only the combined endpoint simply moved every failure onto
    // /ratings, because the skip for it depended on combined failing first.
    const seerrRatingsFailures = { ratings: 0, ratingscombined: 0 };
    // Every ratings request this overlay has actually issued. Seerr's own front
    // end asks the same endpoints for the same missing data, so a console full of
    // 404s says nothing about who caused them; this does. It counts attempts, not
    // failures, and is never reset.
    const seerrRatingsRequests = { ratings: 0, ratingscombined: 0 };
    const RATINGS_ENDPOINTS = new Set(['ratings', 'ratingscombined']);

    // Counted per endpoint, because the two fail independently: Seerr answers
    // /ratingscombined with 200 when it holds either source, so a server with
    // IMDb but no Rotten Tomatoes succeeds there and 404s on /ratings for every
    // card. One shared counter would be reset by those successes and never trip.
    //
    // The implication runs one way. A combined 404 means neither source exists,
    // so /ratings cannot succeed either and both are dropped. A /ratings 404
    // says nothing about IMDb, so combined keeps going.
    function seerrRatingsGivenUp(kind) {
      if (seerrRatingsFailures.ratingscombined >= Config.seerrRatingsFailureLimit) return true;
      return seerrRatingsFailures[kind] >= Config.seerrRatingsFailureLimit;
    }

    // Giving up only lasts as long as the page does, so every reload re-learns
    // the same answer at a cost of twelve failed requests and twelve red console
    // lines per endpoint. A server with no ratings backend configured pays that
    // on every navigation. Remember the verdict instead, per server.
    const RATINGS_UNAVAILABLE_KEY = 'seerrRatingsUnavailableV1';
    // How long the verdict stands before it is worth testing again. Turning the
    // ratings backend on is a deliberate change on the server, so a day of not
    // asking costs little; "Refresh scores" clears it immediately for anyone who
    // does not want to wait.
    const RATINGS_RECHECK_MS = 24 * 60 * 60 * 1000;
    let ratingsAvailabilityReady = null;
    let generation = 0;
    let epoch = 0;

    function loadRatingsAvailability() {
      const expected = generation;
      ratingsAvailabilityReady ??= (async () => {
        try {
          const local = await chrome.storage.local.get([RATINGS_UNAVAILABLE_KEY, 'ratingsCacheEpoch']);
          if (expected !== generation) return loadRatingsAvailability();
          epoch = local.ratingsCacheEpoch ?? 0;
          const stored = local[RATINGS_UNAVAILABLE_KEY];
          if (!stored || typeof stored !== 'object' || (stored.epoch ?? 0) !== epoch) return;
          if (stored.server !== getServer()?.href) return;
          for (const kind of RATINGS_ENDPOINTS) {
            const recordedAt = stored.kinds?.[kind];
            if (typeof recordedAt !== 'number') continue;
            // Inside the window, start given up: no request at all. Past it, sit
            // one short of the limit, so a single 404 re-trips rather than
            // another full dozen.
            seerrRatingsFailures[kind] = Date.now() - recordedAt < RATINGS_RECHECK_MS
              ? Config.seerrRatingsFailureLimit
              : Config.seerrRatingsFailureLimit - 1;
          }
        } catch (error) {
          log('Could not read which ratings endpoints were unavailable:', error);
        }
      })();
      return ratingsAvailabilityReady;
    }

    async function rememberRatingsUnavailable(kind) {
      const expected = generation, writeEpoch = epoch, server = getServer()?.href;
      try {
        if (!server) return;
        const local = await chrome.storage.local.get([RATINGS_UNAVAILABLE_KEY, 'ratingsCacheEpoch']);
        if (expected !== generation || (local.ratingsCacheEpoch ?? 0) !== writeEpoch) return;
        const stored = local[RATINGS_UNAVAILABLE_KEY];
        const kinds = stored?.server === server && (stored.epoch ?? 0) === writeEpoch && stored?.kinds ? { ...stored.kinds } : {};
        kinds[kind] = Date.now();
        await chrome.storage.local.set({ [RATINGS_UNAVAILABLE_KEY]: { server, epoch: writeEpoch, kinds } });
      } catch (error) {
        log('Could not record that ratings are unavailable:', error);
      }
    }

    function resetSeerrRatings() {
      generation++;
      seerrRatingsFailures.ratings = 0;
      seerrRatingsFailures.ratingscombined = 0;
      ratingsAvailabilityReady = null;
      chrome.storage.local.remove([RATINGS_UNAVAILABLE_KEY]).catch(() => {});
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
        .filter(([, kind]) => !(RATINGS_ENDPOINTS.has(kind) && seerrRatingsGivenUp(kind)))
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
          if (kind) {
            if (result.ok) seerrRatingsFailures[kind] = 0;
            else if (result.status === 404) {
              seerrRatingsFailures[kind]++;
              if (seerrRatingsGivenUp(kind)) {
                log(`Seerr has answered ${seerrRatingsFailures[kind]} ${kind} requests with 404; not asking again`);
                rememberRatingsUnavailable(kind);
              }
            }
          }
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

    return { fetchJsonFromSeerr, loadRatingsAvailability, resetSeerrRatings, fetchSeerrSessionRatings, seerrRatingsFailures, seerrRatingsRequests, seerrRatingsGivenUp };
  };
})(globalThis);

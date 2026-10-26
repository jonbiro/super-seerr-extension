// Session-authenticated Seerr reads and per-title ratings resolution.
(function (root) {
  root.createSeerrSession = function ({ Config, Model, log, getServer, bundleFromRatingObject, mergeBundles, isBundleComplete }) {
    const cancelResponseBody = async response => {
      try { await response.body?.cancel(); } catch (_) { /* Preserve the transport error. */ }
    };
    const readBoundedJson = async response => {
      const maxBytes = Config.seerrMaxResponseBytes;
      const announced = Number(response.headers?.get?.('Content-Length'));
      if (Number.isFinite(announced) && announced > maxBytes) {
        await cancelResponseBody(response);
        throw new Error('Seerr returned a response that is too large.');
      }
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            const length = part.value?.byteLength || 0;
            size += length;
            if (size > maxBytes) {
              await reader.cancel().catch(() => {});
              throw new Error('Seerr returned a response that is too large.');
            }
            if (length) chunks.push(part.value);
          }
        } finally { reader.releaseLock(); }
        if (typeof TextDecoder !== 'function') throw new Error('Seerr response could not be decoded.');
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return JSON.parse(new TextDecoder().decode(bytes));
      }
      // Lightweight test doubles and old response shims may only expose json.
      // Browser Responses use the bounded streaming path above.
      if (typeof response.json === 'function') return response.json();
      throw new Error('Seerr response body is unreadable.');
    };
    async function fetchJsonFromSeerr(endpoint, signal) {
      const basePath = getServer()?.pathname.replace(/\/+$/, '') || '';
      const url = new URL(`${basePath}${endpoint}`, window.location.origin);
      const response = await fetch(url.toString(), {
        method: 'GET',
        // A redirect may lead to a login page or another installation on the
        // same host. Its data must never enter this server's ratings cache.
        redirect: 'error',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(Config.requestTimeoutMs)]) : AbortSignal.timeout(Config.requestTimeoutMs),
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });

      if (!response.ok) {
        // Fetch settles at headers. Stop unread error bodies before releasing
        // a rating job, without turning a known HTTP result into a transport error.
        try { await response.body?.cancel(); } catch (_) { /* Preserve the HTTP status. */ }
        log(`Seerr ratings endpoint ${endpoint} returned ${response.status}`);
        return { ok: false, status: response.status, data: null };
      }

      return { ok: true, status: response.status, data: await readBoundedJson(response) };
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
      // Legacy storage cleanup belongs to the trusted worker at startup.
      ratingsAvailabilityReady ??= Promise.resolve();
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
      let bundle = null;
      let ratingsAreAbsent = false;
      for (const [endpoint, endpointKind] of all) {
        if (expected !== generation || outcome.signal?.aborted) { outcome.conclusive = false; return null; }
        // Re-evaluate after every response: earlier endpoints may have filled
        // the fields that a later endpoint could contribute.
        if (!endpointCanHelp(mergeBundles(known, bundle), SESSION_ENDPOINT_FIELDS[endpointKind])) continue;
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
          const result = await fetchJsonFromSeerr(endpoint, outcome.signal);
          if (expected !== generation || outcome.signal?.aborted) { outcome.conclusive = false; return null; }
          if (!result.ok) {
            if (result.status === 404 && endpoint.endsWith('/ratingscombined')) ratingsAreAbsent = true;
            // 404 is Seerr saying it has nothing. A 500 or a 401 is Seerr failing
            // to say anything, and must not be recorded as "this title is unrated".
            else if (result.status !== 404) outcome.conclusive = false;
            continue;
          }
          const detailId = result.data?.id;
          if (endpointKind === 'detail' && detailId !== undefined &&
              (!['number', 'string'].includes(typeof detailId) || !/^[1-9]\d*$/.test(String(detailId)) ||
                !Number.isSafeInteger(Number(detailId)) || Number(detailId) !== Number(tmdbId))) {
            // A proxy or stale server response can name another title. It is
            // not evidence for this card and must remain retryable.
            outcome.conclusive = false;
            log(`Ignoring Seerr detail identity mismatch for ${endpoint}`);
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
        if (isBundleComplete(mergeBundles(known, bundle))) {
          log(`Seerr ratings complete after ${endpoint}; skipping remaining endpoints`);
          break;
        }
      }

      return bundle && Model.hasAnyScore(bundle) ? bundle : null;
    }

    return { fetchJsonFromSeerr, loadRatingsAvailability, resetSeerrRatings, fetchSeerrSessionRatings, seerrRatingsRequests };
  };
})(typeof window !== 'undefined' ? window : globalThis);

// Seerr API observer — runs in the page's own world at document_start.
//
// Seerr's title cards keep their link, title and alt text inside a Transition
// that unmounts when not hovered, so an un-hovered card exposes nothing but
// its poster image. The data needed to identify it is already being fetched by
// the page, so rather than re-request it we watch what the page receives and
// forward a narrow projection to the content script.
//
// Nothing here trusts or is trusted: it reads responses, takes a fixed set of
// fields, and posts them same-origin. The content script revalidates.
(function () {
  if (window.__seerrApiObserverInstalled) return;
  window.__seerrApiObserverInstalled = true;

  const CHANNEL = 'super-seerr:api';
  const DIAGNOSE_REQUEST = 'super-seerr:diagnose';
  const DIAGNOSE_RESULT = 'super-seerr:diagnosed';
  const MAX_ITEMS = 200;
  const MAX_DEPTH = 4;

  // Endpoints that carry title lists, per Seerr's router. Anything about the
  // account, the server configuration, other users, or issue discussions is
  // deliberately not observed.
  const WATCHED = /\/api\/v1\/(discover|search|request|media|movie|tv|collection|watchlist|blocklist|person)(\/|\?|$)/;
  const IGNORED = /\/api\/v1\/(auth|user|settings|service|status|issue|issueComment)(\/|\?|$)/;

  // Only these fields are ever forwarded.
  const FIELDS = [
    'id', 'tmdbId', 'mediaType', 'type',
    'title', 'name', 'originalTitle', 'originalName',
    'releaseDate', 'firstAirDate',
    'posterPath', 'poster_path',
    'rtCriticsScore', 'rtAudienceScore', 'criticsScore', 'audienceScore',
    'imdbRating', 'imdbScore', 'tmdbRating', 'tmdbScore', 'voteAverage'
  ];
  const NESTED = ['media', 'mediaInfo', 'movie', 'tv', 'request'];

  function project(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > MAX_DEPTH) return null;
    const out = {};
    for (const field of FIELDS) {
      const found = value[field];
      if (typeof found === 'string' || typeof found === 'number' || typeof found === 'boolean') out[field] = found;
    }
    for (const field of NESTED) {
      const nested = project(value[field], depth + 1);
      if (nested) out[field] = nested;
    }
    return Object.keys(out).length > 0 ? out : null;
  }

  function itemsOf(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];
    for (const key of ['results', 'items', 'titles']) {
      if (Array.isArray(payload[key])) return payload[key];
    }
    // A detail endpoint returns a single object rather than a list.
    return [payload];
  }

  function publish(url, payload) {
    try {
      const items = itemsOf(payload).slice(0, MAX_ITEMS).map(item => project(item)).filter(Boolean);
      if (items.length === 0) return;
      window.postMessage({ channel: CHANNEL, url: String(url), items }, window.location.origin);
    } catch (_) {
      // Observing must never disturb the page.
    }
  }

  function watched(url) {
    try {
      const resolved = new URL(String(url), window.location.href);
      if (resolved.origin !== window.location.origin) return false;
      return WATCHED.test(resolved.pathname) && !IGNORED.test(resolved.pathname);
    } catch (_) {
      return false;
    }
  }

  // The overlay's diagnostics live in the extension's isolated world, which a
  // DevTools console cannot reach without switching context. Expose a bridge
  // here so `superSeerrDiagnose()` works from the default console.
  let diagnoseCounter = 0;
  window.superSeerrDiagnose = function () {
    const id = `d${++diagnoseCounter}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        window.removeEventListener('message', onResult);
        reject(new Error('Super Seerr did not answer. Its overlay may not be running on this page.'));
      }, 5000);
      function onResult(event) {
        if (event.source !== window || event.origin !== window.location.origin) return;
        if (event.data?.channel !== DIAGNOSE_RESULT || event.data.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener('message', onResult);
        resolve(event.data.report);
      }
      window.addEventListener('message', onResult);
      window.postMessage({ channel: DIAGNOSE_REQUEST, id }, window.location.origin);
    });
  };

  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = function (...args) {
      const response = originalFetch.apply(this, args);
      try {
        const url = args[0] && typeof args[0] === 'object' ? args[0].url : args[0];
        if (watched(url)) {
          // clone() so the page still gets an unread body.
          response.then(res => {
            try {
              if (res?.ok) res.clone().json().then(data => publish(url, data), () => {});
            } catch (_) {
              // clone() throws when the body is already used. The page's own
              // read is unaffected; without this the throw becomes an
              // unhandled rejection in the page's console.
            }
          }, () => {});
        }
      } catch (_) {
        // Fall through; the page's response is already on its way.
      }
      return response;
    };
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    try { this.__seerrUrl = url; } catch (_) { /* frozen instance */ }
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    try {
      if (watched(this.__seerrUrl)) {
        this.addEventListener('load', () => {
          try {
            if (this.status < 200 || this.status >= 300) return;
            const body = this.responseType === '' || this.responseType === 'text' ? JSON.parse(this.responseText) : this.response;
            publish(this.__seerrUrl, body);
          } catch (_) { /* not JSON */ }
        });
      }
    } catch (_) { /* never block the request */ }
    return originalSend.apply(this, args);
  };
})();

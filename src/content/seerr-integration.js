// Seerr Pre-Request Ratings Overlay
// Injects Rotten Tomatoes context on Seerr browse cards and detail pages.
// Prefers Seerr-native ratings data; falls back to confidence-aware resolution.
// The request flow remains visually primary throughout.

(function () {
  if (window.__seerr_overlay_installed) return;

  const Model = window.RatingsModel;
  const Config = window.RatingsConfig;
  if (!Model || !Config) return;
  window.__seerr_overlay_installed = true;

  let debugMode = false;
  function log(...args) { if (debugMode) console.log('🍅 [Seerr Overlay]', ...args); }

  const FEATURE_FLAGS = {
    cardBadges: true,
    detailRatingsRow: true,
    preRequestSummary: true,
    sortFilter: true,
    bulkActions: true,
  };

  let apiConfigured = false;
  let configuredServer = null;

  // Check API config — controls whether request features are available.
  // The API key is deliberately never read here: the worker answers whether
  // requests are possible so the secret stays out of this page's heap.
  async function checkApiConfig() {
    try {
      const settings = await chrome.storage.sync.get(['seerrUrl', 'overlayFeatures']);
      const previousServer = configuredServer?.href;
      for (const flag of Object.keys(FEATURE_FLAGS)) FEATURE_FLAGS[flag] = settings.overlayFeatures?.[flag] !== false;
      try {
        configuredServer = settings.seerrUrl ? new URL(settings.seerrUrl) : null;
      } catch (_) {
        configuredServer = null;
      }
      // A different server's ratings are meaningless here.
      if (previousServer !== configuredServer?.href) forgetPersistedRatings();

      const response = await chrome.runtime.sendMessage({ action: 'getConfigState' }).catch(() => null);
      apiConfigured = response?.success === true && response.data?.apiConfigured === true;
      log('API configured:', apiConfigured);
    } catch (error) {
      log('Could not load Seerr settings:', error);
    }
  }
  checkApiConfig().then(() => injectOverlay());

  // Update when settings change (e.g., user configures from options page).
  // The URL and feature flags sync; the API key is device-local.
  chrome.storage.onChanged.addListener((changes, namespace) => {
    // Settings clears the cache by removing the key. Our own flushes always
    // write a value, so only a removal counts as a clear.
    if (namespace === 'local' && changes[PERSISTED_RATINGS_KEY] && changes[PERSISTED_RATINGS_KEY].newValue === undefined) {
      forgetPersistedRatings();
      cleanupOverlay();
      injectOverlay();
      return;
    }
    const relevant = (namespace === 'sync' && (changes.seerrUrl || changes.overlayFeatures)) ||
      (namespace === 'local' && changes.seerrApiKey);
    if (relevant) checkApiConfig().then(() => { cleanupOverlay(); injectOverlay(); });
  });

  // key: `${mediaType}:${tmdbId}`, value: { bundle }. `pending:` keys hold the
  // in-flight promise instead, so serialisation skips them.
  const ratingsCache = new Map();

  // Resolved bundles persist so a page reload does not re-resolve every card.
  // There is no expiry by design: entries live until the entry cap evicts them
  // or the user clears the cache from Settings.
  const PERSISTED_RATINGS_KEY = 'overlayRatingsV1';
  const PERSISTED_RATINGS_FLUSH_MS = 500;
  let persistedRatingsReady = null;
  let persistedRatingsFlushTimer = null;
  let persistedRatingsFlushing = null;

  function loadPersistedRatings() {
    persistedRatingsReady ??= (async () => {
      try {
        const stored = (await chrome.storage.local.get([PERSISTED_RATINGS_KEY]))[PERSISTED_RATINGS_KEY];
        if (!stored || typeof stored !== 'object') return;
        // Entries belong to the server they were read from.
        if (stored.server !== configuredServer?.href) return;
        if (!stored.entries || typeof stored.entries !== 'object') return;
        for (const [key, entry] of Object.entries(stored.entries)) {
          // A live entry from this session is fresher than anything stored.
          if (ratingsCache.has(key) || !entry || typeof entry !== 'object') continue;
          // Older builds persisted the bare bundle with no wrapper.
          const bundle = entry.bundle ?? entry;
          if (!bundle || typeof bundle !== 'object') continue;
          ratingsCache.set(key, {
            bundle: Model.createRatingsBundle(bundle),
            cachedAt: typeof entry.cachedAt === 'number' ? entry.cachedAt : null
          });
        }
      } catch (error) {
        log('Could not read the stored ratings cache:', error);
      }
    })();
    return persistedRatingsReady;
  }

  function schedulePersistedRatingsFlush() {
    if (persistedRatingsFlushTimer !== null) return;
    persistedRatingsFlushTimer = setTimeout(() => {
      persistedRatingsFlushTimer = null;
      flushPersistedRatings();
    }, PERSISTED_RATINGS_FLUSH_MS);
  }

  // Serialised so overlapping flushes cannot interleave their writes.
  function flushPersistedRatings() {
    persistedRatingsFlushing = (persistedRatingsFlushing ?? Promise.resolve()).then(async () => {
      try {
        if (!configuredServer) return;
        const entries = {};
        for (const [key, value] of ratingsCache) {
          if (key.startsWith('pending:') || !value?.bundle) continue;
          // Storing "found nothing" without an expiry would mean never looking
          // again, so only bundles carrying a score are kept.
          if (!Model.hasAnyScore(value.bundle)) continue;
          entries[key] = { bundle: value.bundle, cachedAt: value.cachedAt ?? null };
        }
        await chrome.storage.local.set({ [PERSISTED_RATINGS_KEY]: { server: configuredServer.href, entries } });
      } catch (error) {
        log('Could not persist the ratings cache:', error);
      }
    });
    return persistedRatingsFlushing;
  }

  function forgetPersistedRatings() {
    ratingsCache.clear();
    persistedRatingsReady = null;
  }
  const embeddedRatingsByTmdbId = new Map();
  const pageRatingsByTmdbId = new Map();
  const pageMetadataByTmdbId = new Map();
  const pageRatingsFetches = new Map();
  let embeddedRatingsIndexed = false;

  // ──────────────── Route Detection ────────────────

  function serverPath() {
    const base = configuredServer?.pathname.replace(/\/+$/, '') || '';
    if (base && window.location.pathname === base) return '/';
    return base && window.location.pathname.startsWith(`${base}/`)
      ? window.location.pathname.slice(base.length) : window.location.pathname;
  }

  // Every Seerr page that renders title cards. A route that is not recognised
  // gets no badges and no sort or filter controls.
  const LIST_ROUTES = new Set(['discover', 'search', 'requests', 'collection', 'person', 'blocklist', 'watchlist']);

  function detectRoute() {
    const path = serverPath();
    if (/^\/movie\/\d+/.test(path)) return { type: 'movie-detail', id: path.match(/\/movie\/(\d+)/)[1] };
    if (/^\/tv\/\d+/.test(path))    return { type: 'tv-detail',    id: path.match(/\/tv\/(\d+)/)[1] };
    if (/^\/collection\/\d+/.test(path)) return { type: 'collection', id: path.match(/\/collection\/(\d+)/)[1] };
    if (/^\/person\/\d+/.test(path))     return { type: 'person',     id: path.match(/\/person\/(\d+)/)[1] };
    if (/^\/search/.test(path))     return { type: 'search' };
    if (/^\/discover/.test(path))   return { type: 'discover' };
    if (/^\/requests(?:\/|$)/.test(path)) return { type: 'requests' };
    if (/^\/blocklist(?:\/|$)/.test(path)) return { type: 'blocklist' };
    // Only the watchlist tab of a profile shows titles; its settings do not.
    if (/^\/profile\/watchlist(?:\/|$)/.test(path)) return { type: 'watchlist' };
    if (path === '/')               return { type: 'discover' };
    return null;
  }

  function isListRoute(route) {
    return !!route && LIST_ROUTES.has(route.type);
  }

  // ──────────────── SPA Navigation ────────────────

  let currentPath = window.location.pathname + window.location.search;
  let routeGeneration = 0;
  if (!history.__seerrOverlayPatched) {
    history.__seerrOverlayPatched = true;
    const originalPushState = history.pushState;
    history.pushState = function (...args) {
      originalPushState.apply(history, args);
      setTimeout(handleRouteChange, 150);
    };
    const originalReplaceState = history.replaceState;
    history.replaceState = function (...args) {
      originalReplaceState.apply(history, args);
      setTimeout(handleRouteChange, 150);
    };
  }
  window.addEventListener('popstate', () => setTimeout(handleRouteChange, 150));
  // Isolated content scripts cannot reliably patch the page's history methods.
  let navigationTimer = setInterval(handleRouteChange, 1000);
  window.addEventListener('pagehide', () => {
    clearInterval(navigationTimer); navigationTimer = null;
    if (cardObserver) { cardObserver.disconnect(); cardObserver = null; }
    clearTimeout(cardObserverTimer);
  });
  window.addEventListener('pageshow', () => {
    if (navigationTimer === null) navigationTimer = setInterval(handleRouteChange, 1000);
    if (isSeerrPage() && isListRoute(detectRoute())) setupCardObserver();
  });

  function handleRouteChange() {
    const nextPath = window.location.pathname + window.location.search;
    if (nextPath === currentPath) return;
    currentPath = nextPath;
    if (!isSeerrPage()) return;
    seerrDomReadyRetries = 0;
    cleanupOverlay();
    injectOverlay();
  }

  // ──────────────── Idempotency ────────────────

  function isAlreadyInjected() {
    // Check per-route type to allow re-injection on new pages (e.g., infinite scroll)
    const route = detectRoute();
    const selector = isListRoute(route)
      ? '[data-seerr-overlay="true"].seerr-card-badge'
      : '[data-seerr-overlay="true"]';
    return document.querySelector(selector);
  }

  function cleanupOverlay() {
    routeGeneration++;
    const cards = getMediaCards();
    for (const grid of new Set(cards.map(card => getCardsGrid([card])).filter(Boolean))) {
      applyScoreSort(grid, 'default');
    }
    cards.forEach(card => {
      card.style.display = '';
      getCardLayoutItem(card).style.display = '';
      card.__seerrBadgesResolving = false;
      card.__seerrBadgesCleared = true;
      delete card.__seerrRatings;
      delete card.__seerrMediaInfo;
      delete card.__seerrListMediaInfo;
    });
    bulkMode = false;
    selectedCards.clear();
    bulkActionBar = null;
    lastListItems = [];
    document.querySelectorAll('[data-seerr-overlay="true"]').forEach(el => el.remove());
    // Also remove the filter toggle button
    const toggle = document.getElementById('seerr-filter-toggle');
    if (toggle) toggle.remove();
    embeddedRatingsByTmdbId.clear();
    pageRatingsByTmdbId.clear();
    pageMetadataByTmdbId.clear();
    pageRatingsFetches.clear();
    embeddedRatingsIndexed = false;
    // Reset filter state so new page starts with no filters applied
    currentSort = 'default';
    currentFilters.minCritics = 0;
    currentFilters.minAudience = 0;
    currentFilters.minTmdb = 0;
    // Disconnect card mutation observer so it doesn't fire on the old page
    if (cardObserver) { cardObserver.disconnect(); cardObserver = null; }
    clearTimeout(cardObserverTimer);
  }

  // ──────────────── Ratings Resolution ────────────────

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

  function parseTenPointScore(value) {
    const score = parseScore(value, 10);
    return score === null ? null : Math.round(score * 10) / 10;
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

  function objectTmdbId(obj) {
    if (!obj || typeof obj !== 'object') return null;
    return obj.tmdbId ?? obj.mediaInfo?.tmdbId ?? obj.media?.tmdbId ?? obj.media?.id ?? obj.id ?? null;
  }

  function mediaTypeOf(obj, fallback = null) {
    const type = obj?.mediaType || obj?.type || obj?.media?.mediaType || obj?.mediaInfo?.mediaType;
    if (type === 'movie' || type === 'tv') return type;
    if (obj?.firstAirDate) return 'tv';
    if (obj?.releaseDate) return 'movie';
    return fallback;
  }

  function ratingKey(id, mediaType) { return `${mediaType || 'unknown'}:${id}`; }

  function objectTitle(obj) {
    if (!obj || typeof obj !== 'object') return '';
    return obj.title || obj.name || obj.originalTitle || obj.originalName || obj.mediaInfo?.title || obj.mediaInfo?.name || obj.media?.title || obj.media?.name || '';
  }

  function objectYear(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const date = obj.releaseDate || obj.firstAirDate || obj.mediaInfo?.releaseDate || obj.mediaInfo?.firstAirDate || obj.media?.releaseDate || obj.media?.firstAirDate || '';
    const year = parseInt(String(date).slice(0, 4), 10);
    return Number.isFinite(year) ? year : null;
  }

  function indexEmbeddedRatings() {
    if (embeddedRatingsIndexed) return;
    embeddedRatingsIndexed = true;

    const scripts = document.querySelectorAll('script[type="application/json"], script#__NEXT_DATA__');
    const seen = new WeakSet();

    function visit(node, inheritedType = null) {
      if (!node || typeof node !== 'object' || seen.has(node)) return;
      seen.add(node);

      const tmdbId = objectTmdbId(node);
      const route = detectRoute();
      const routeType = String(route?.id) === String(tmdbId) ? route?.type.split('-')[0] : null;
      const mediaType = mediaTypeOf(node, inheritedType || routeType);
      if (tmdbId !== null && tmdbId !== undefined) {
        let bundle = bundleFromRatingObject(node, 'seerr-native');
        bundle = mergeBundles(bundle, bundleFromRatingObject(node.mediaInfo, 'seerr-native'));
        bundle = mergeBundles(bundle, bundleFromRatingObject(node.media, 'seerr-native'));
        if (bundle && Model.hasAnyScore(bundle)) {
          const key = ratingKey(tmdbId, mediaType);
          embeddedRatingsByTmdbId.set(key, mergeBundles(embeddedRatingsByTmdbId.get(key), bundle));
        }
      }

      if (Array.isArray(node)) {
        node.forEach(child => visit(child, inheritedType));
      } else {
        Object.keys(node).forEach(key => visit(node[key], mediaType));
      }
    }

    scripts.forEach(script => {
      try {
        visit(JSON.parse(script.textContent));
      } catch (_) {}
    });
  }

  function extractSeerrNativeRatings(tmdbId = null, mediaType = null) {
    indexEmbeddedRatings();
    const route = detectRoute();
    const type = mediaType || (String(route?.id) === String(tmdbId) ? route?.type.split('-')[0] : null);
    return embeddedRatingsByTmdbId.get(ratingKey(tmdbId, type)) || null;
  }

  async function fetchJsonFromSeerr(endpoint) {
    const basePath = configuredServer?.pathname.replace(/\/+$/, '') || '';
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

  async function fetchSeerrSessionRatings(tmdbId, mediaType) {
    if (!tmdbId || !mediaType) return null;

    const endpoints = mediaType === 'tv'
      ? [`/api/v1/tv/${tmdbId}/ratings`, `/api/v1/tv/${tmdbId}`]
      : [`/api/v1/movie/${tmdbId}/ratingscombined`, `/api/v1/movie/${tmdbId}/ratings`, `/api/v1/movie/${tmdbId}`];

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
        const result = await fetchJsonFromSeerr(endpoint);
        if (!result.ok) {
          if (result.status === 404 && endpoint.endsWith('/ratingscombined')) ratingsAreAbsent = true;
          continue;
        }
        const next = bundleFromRatingObject(result.data, endpoint.includes('ratings') ? 'seerr-ratings-api' : 'seerr-details-api');
        bundle = mergeBundles(bundle, next);
      } catch (error) {
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

  function getListRatingsEndpoint(route) {
    const search = window.location.search || '';
    if (route?.type === 'discover') {
      if (/^\/discover\/tv/.test(serverPath())) return `/api/v1/discover/tv${search}`;
      if (/^\/discover\/movies/.test(serverPath())) return `/api/v1/discover/movies${search}`;
    }
    if (route?.type === 'search') return `/api/v1/search${search}`;
    if (route?.type === 'requests') {
      return '/api/v1/request?take=100&skip=0';
    }
    return null;
  }

  function indexRatingsResult(item, source) {
    if (!item || typeof item !== 'object') return;
    const candidates = [
      item,
      item.media,
      item.mediaInfo,
      item.movie,
      item.tv,
      item.request?.media
    ].filter(Boolean);

    const fallbackType = mediaTypeOf(item, /^\/discover\/tv/.test(serverPath()) ? 'tv' : /^\/discover\/movies/.test(serverPath()) ? 'movie' : null);
    candidates.forEach(candidate => {
      const tmdbId = objectTmdbId(candidate);
      const bundle = bundleFromRatingObject(candidate, source);
      if (tmdbId !== null && tmdbId !== undefined) {
        const key = ratingKey(tmdbId, mediaTypeOf(candidate, fallbackType));
        const title = objectTitle(candidate);
        const year = objectYear(candidate);
        if (title || year) {
          pageMetadataByTmdbId.set(key, {
            title: title || pageMetadataByTmdbId.get(key)?.title || '',
            year: year || pageMetadataByTmdbId.get(key)?.year || null
          });
        }
      }
      if (tmdbId !== null && tmdbId !== undefined && bundle && Model.hasAnyScore(bundle)) {
        const key = ratingKey(tmdbId, mediaTypeOf(candidate, fallbackType));
        pageRatingsByTmdbId.set(key, mergeBundles(pageRatingsByTmdbId.get(key), bundle));
      }
    });
  }

  function mediaInfoFromListItem(item) {
    if (!item || typeof item !== 'object') return null;
    const candidate = item.media || item.mediaInfo || item.movie || item.tv || item;
    const tmdbId = objectTmdbId(candidate);
    if (tmdbId === null || tmdbId === undefined) return null;

    const mediaType = mediaTypeOf(candidate, mediaTypeOf(item,
      /^\/discover\/tv/.test(serverPath()) ? 'tv' : /^\/discover\/movies/.test(serverPath()) ? 'movie' : null));
    if (!mediaType) return null;

    return {
      link: null,
      href: `/${mediaType}/${tmdbId}`,
      mediaType,
      tmdbId: String(tmdbId),
      title: objectTitle(candidate),
      year: objectYear(candidate)
    };
  }

  // Both the observer and explicit list fetches feed this, so it accumulates
  // and is bounded rather than replaced.
  function rememberListItems(items) {
    if (!Array.isArray(items) || items.length === 0) return;
    lastListItems = lastListItems.concat(items);
    if (lastListItems.length > Config.overlayCacheMaxEntries) {
      lastListItems = lastListItems.slice(-Config.overlayCacheMaxEntries);
    }
  }

  // Why a given card has no identity yet. Distinguishes "Seerr has not mounted
  // the link" from "nothing we observed matches this poster" from "the poster
  // matches more than one title, so resolving it would be a guess".
  function explainUnresolvedCards(limit = 5) {
    return getMediaCards()
      .filter(card => !getCardMediaInfo(card))
      .slice(0, limit)
      .map(card => {
        const posterUrl = (card.querySelector('img')?.getAttribute('src') || '').split('?')[0];
        const posterMatches = lastListItems.filter(item => {
          const poster = item?.posterPath || item?.poster_path;
          return typeof poster === 'string' && poster.length > 1 && posterUrl.endsWith(poster);
        });
        return {
          posterUrl: posterUrl || null,
          hasMediaLink: Array.from(card.querySelectorAll('a[href]')).some(a => MEDIA_LINK_RE.test(a.getAttribute('href') || '')),
          posterMatches: posterMatches.length,
          reason: !posterUrl ? 'no poster image to match on'
            : lastListItems.length === 0 ? 'nothing observed from the page yet'
            : posterMatches.length === 0 ? 'no observed title has this poster'
            : posterMatches.length > 1 ? 'more than one observed title has this poster'
            : 'resolvable; awaiting the next pass'
        };
      });
  }

  function hydrateCardsFromListItems(root = document) {
    if (!lastListItems.length) return;
    const cards = getMediaCards(root);
    cards.forEach(card => {
      if (getCardMediaInfo(card)) return;
      const title = (card.querySelector('h2, h3, [class*="title"], [class*="Title"]')?.textContent
        || card.querySelector('img[alt]')?.getAttribute('alt') || '').trim().toLowerCase();
      const image = card.querySelector('img');
      const posterUrl = image?.getAttribute('src') || '';
      const posterMatches = lastListItems.filter(item => {
        const poster = item.posterPath || item.poster_path;
        return typeof poster === 'string' && poster.length > 1 && posterUrl.split('?')[0].endsWith(poster);
      });
      const matches = posterMatches.length
        ? posterMatches.map(mediaInfoFromListItem).filter(Boolean)
        : lastListItems.map(mediaInfoFromListItem).filter(info => title && info && info.title.trim().toLowerCase() === title);
      // DOM order can differ from API order after sorting or lazy loading.
      // An ambiguous title must remain unresolved rather than request the wrong ID.
      if (matches.length !== 1) return;
      const info = matches[0];
      card.__seerrListMediaInfo = info;
    });
  }

  // ──────────────── Page API observations ────────────────
  // The page-world observer forwards the title lists Seerr fetches for itself.
  // Seerr keeps a card's link and title unmounted until it is hovered, so
  // without this an un-hovered card offers nothing but its poster image.
  // Counters so diagnose() can tell "the observer never spoke" apart from
  // "it spoke but nothing matched".
  const observedStats = { messages: 0, items: 0, byUrl: new Map(), lastAt: null, rejected: 0 };

  function handleObservedApiResponse(event) {
    // Same window, same origin, and our channel: anything else is not ours.
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.channel !== 'super-seerr:api') return;
    if (!Array.isArray(data.items)) { observedStats.rejected++; return; }
    if (!isSeerrPage()) { observedStats.rejected++; return; }

    observedStats.messages++;
    observedStats.items += data.items.length;
    observedStats.lastAt = Date.now();
    const path = (() => { try { return new URL(data.url, window.location.href).pathname; } catch (_) { return String(data.url); } })();
    observedStats.byUrl.set(path, (observedStats.byUrl.get(path) || 0) + data.items.length);

    const source = String(data.url || '').includes('/request') ? 'seerr-requests-api' : 'seerr-discover-api';
    const usable = data.items.filter(item => item && typeof item === 'object');
    if (usable.length === 0) return;
    usable.forEach(item => indexRatingsResult(item, source));
    // Poster matching needs the raw items, not just the ratings index.
    rememberListItems(usable);
    hydrateCardsFromListItems();
    scheduleObservedRefresh();
  }

  let observedRefreshTimer = null;
  function scheduleObservedRefresh() {
    if (observedRefreshTimer !== null) return;
    observedRefreshTimer = setTimeout(() => {
      observedRefreshTimer = null;
      if (!isSeerrPage()) return;
      injectCardBadges();
      injectSortFilterControls();
    }, 200);
  }

  window.addEventListener('message', handleObservedApiResponse);

  async function indexCurrentListRatings() {
    const route = detectRoute();
    const endpoint = getListRatingsEndpoint(route);
    if (!endpoint) return;
    if (pageRatingsFetches.has(endpoint)) return pageRatingsFetches.get(endpoint);

    const generation = routeGeneration;
    const promise = (async () => {
      try {
        const result = await fetchJsonFromSeerr(endpoint);
        if (generation !== routeGeneration) return;
        const data = result?.ok ? result.data : null;
        const results = Array.isArray(data) ? data : (data?.results || data?.items || data?.titles || []);
        // Append rather than replace: the page-world observer contributes to
        // the same list, and an explicit fetch must not discard its items.
        rememberListItems(results);
        results.forEach(item => indexRatingsResult(item, endpoint.includes('/request') ? 'seerr-requests-api' : 'seerr-discover-api'));
        hydrateCardsFromListItems();
      } catch (error) {
        log(`Seerr list ratings fetch failed for ${endpoint}:`, error);
      }
    })();

    pageRatingsFetches.set(endpoint, promise);
    return promise;
  }

  async function fetchRottenTomatoesRatings(title, year, mediaType, refresh = false) {
    if (!title) return null;

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'getRottenTomatoesRatings',
        // The worker holds RT for 24 hours, and RT is the score most likely to
        // have moved, so a refresh has to reach past that cache too.
        data: { title, year, mediaType, refresh }
      });
      if (!response?.success || !response.data) return null;

      return Model.createRatingsBundle({
        rtCriticsScore: response.data.rtCriticsScore ?? null,
        rtAudienceScore: response.data.rtAudienceScore ?? null,
        confidence: response.data.confidence ?? 0,
        source: response.data.source || 'rotten-tomatoes',
        lastUpdated: Date.now()
      });
    } catch (error) {
      log('Rotten Tomatoes lookup failed:', error);
      return null;
    }
  }

  async function resolveRatings(tmdbId, title, year, mediaType = null, options = {}) {
    log(`Resolving ratings for TMDB ${tmdbId}`);
    const native = extractSeerrNativeRatings(tmdbId, mediaType);
    await indexCurrentListRatings();
    const pageMeta = tmdbId !== null && tmdbId !== undefined ? pageMetadataByTmdbId.get(ratingKey(tmdbId, mediaType)) : null;
    const lookupTitle = title || pageMeta?.title || '';
    const lookupYear = year || pageMeta?.year || null;
    const pageBundle = tmdbId !== null && tmdbId !== undefined ? pageRatingsByTmdbId.get(ratingKey(tmdbId, mediaType)) : null;
    let bundle = mergeBundles(native, pageBundle);

    if (!bundle || bundle.rtCriticsScore === null || bundle.rtAudienceScore === null) {
      const rtBundle = await fetchRottenTomatoesRatings(lookupTitle, lookupYear, mediaType, options.refresh === true);
      if (rtBundle && rtBundle.confidence >= Config.confidenceThreshold) {
        bundle = mergeBundles(bundle, rtBundle);
      }
    }
    // Continue filling partial bundles without overwriting higher-trust data.
    if (!isBundleComplete(bundle)) {
      bundle = mergeBundles(bundle, await fetchSeerrSessionRatings(tmdbId, mediaType));
    }
    return bundle || Model.createRatingsBundle({ lastUpdated: Date.now() });
  }

  function ratingsCacheKey(tmdbId, title = '', year = null, mediaType = null) {
    return `${mediaType || 'unknown'}:${tmdbId || `${title}:${year || ''}`}`;
  }

  // Drop the given titles so the next lookup resolves them again. Scoped to
  // what the caller names, so refreshing a grid leaves the rest cached.
  function forgetRatings(titles) {
    let forgotten = 0;
    for (const { tmdbId, title = '', year = null, mediaType = null } of titles) {
      if (ratingsCache.delete(ratingsCacheKey(tmdbId, title, year, mediaType))) forgotten++;
      // The page-level index would otherwise re-seed the same stale scores.
      pageRatingsByTmdbId.delete(ratingKey(tmdbId, mediaType));
      embeddedRatingsByTmdbId.delete(ratingKey(tmdbId, mediaType));
    }
    if (forgotten > 0) schedulePersistedRatingsFlush();
    return forgotten;
  }

  // When the oldest of these titles was resolved, or null if none is recorded.
  function ratingsCacheAge(titles) {
    let oldest = null;
    for (const { tmdbId, title = '', year = null, mediaType = null } of titles) {
      const entry = ratingsCache.get(ratingsCacheKey(tmdbId, title, year, mediaType));
      if (!entry || typeof entry.cachedAt !== 'number') continue;
      if (oldest === null || entry.cachedAt < oldest) oldest = entry.cachedAt;
    }
    return oldest;
  }

  // The titles currently on screen, which is what a refresh acts on.
  function loadedTitles(grid) {
    return getMediaCards(grid)
      .map(card => getCardMediaInfo(card))
      .filter(info => info && info.tmdbId);
  }

  function describeCacheAge(cachedAt) {
    if (cachedAt === null) return '';
    const days = Math.floor((Date.now() - cachedAt) / 86400000);
    if (days < 1) return 'cached today';
    if (days === 1) return 'cached yesterday';
    return `cached ${days} days ago`;
  }

  // Forget the loaded titles and resolve them again, reaching past the
  // worker's Rotten Tomatoes cache as well.
  async function refreshLoadedScores(grid) {
    const titles = loadedTitles(grid);
    if (titles.length === 0) return 0;

    forgetRatings(titles);
    // The page-level fetch is memoised per endpoint; drop it so the list
    // ratings are re-read rather than replayed from this page load.
    pageRatingsFetches.clear();

    const cards = getMediaCards(grid);
    cards.forEach(card => {
      card.querySelectorAll('[data-seerr-overlay="true"][class*="card-badge"]').forEach(badge => badge.remove());
      delete card.__seerrRatings;
      card.__seerrBadgesResolving = false;
      card.__seerrBadgesCleared = false;
    });

    const generation = routeGeneration;
    await Promise.all(titles.map(info =>
      getRatings(info.tmdbId, info.title, null, info.mediaType, { refresh: true }).catch(() => null)
    ));
    if (generation !== routeGeneration) return 0;

    injectCardBadges();
    return titles.length;
  }

  async function getRatings(tmdbId, title, year, mediaType = null, options = {}) {
    await loadPersistedRatings();

    const key = ratingsCacheKey(tmdbId, title, year, mediaType);
    const cached = options.refresh === true ? null : ratingsCache.get(key);
    if (cached) {
      log(`Cache hit for ${key}`);
      // Re-insert to mark it most recently used, so the cap evicts by use
      // rather than by insertion order.
      ratingsCache.delete(key);
      ratingsCache.set(key, cached);
      return cached.bundle;
    }

    // Coalesce concurrent requests
    const pendingKey = `pending:${key}`;
    if (ratingsCache.has(pendingKey)) {
      log(`Coalescing request for ${key}`);
      return ratingsCache.get(pendingKey);
    }

    const promise = resolveRatings(tmdbId, title, year, mediaType, options);
    ratingsCache.set(pendingKey, promise);

    try {
      const bundle = await promise;
      if (bundle && ratingsCache.get(pendingKey) === promise) {
        while (resolvedCacheSize() >= Config.overlayCacheMaxEntries) {
          const lru = [...ratingsCache.keys()].find(existingKey => !existingKey.startsWith('pending:'));
          if (lru === undefined) break;
          ratingsCache.delete(lru);
        }
        ratingsCache.set(key, { bundle, cachedAt: Date.now() });
        schedulePersistedRatingsFlush();
      }
      return bundle;
    } finally {
      if (ratingsCache.get(pendingKey) === promise) ratingsCache.delete(pendingKey);
    }
  }

  function resolvedCacheSize() {
    let count = 0;
    for (const key of ratingsCache.keys()) if (!key.startsWith('pending:')) count++;
    return count;
  }

  // ──────────────── Quality Summary ────────────────

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

  const MEDIA_LINK_RE = /\/(movie|tv)\/(\d+)/;
  const MEDIA_CARD_CONTAINER_SELECTOR = '[data-testid="title-card"], [class*="MediaCard"], [class*="media-item"], article, li, [class*="card"], [class*="Card"]';
  let nextCardIndex = 0;
  let lastListItems = [];

  function getCardMediaInfo(card) {
    if (card.__seerrMediaInfo) return card.__seerrMediaInfo;

    const links = card.matches?.('a[href]') ? [card] : Array.from(card.querySelectorAll('a[href]'));
    const link = links.find(a => MEDIA_LINK_RE.test(a.getAttribute('href') || ''));
    if (!link) return card.__seerrListMediaInfo || null;

    const href = link.getAttribute('href') || '';
    const tmdbMatch = href.match(MEDIA_LINK_RE);
    if (!tmdbMatch) return null;

    const titleEl = card.querySelector('h2, h3, [class*="title"], [class*="Title"]');
    const imageAlt = card.querySelector('img[alt]')?.getAttribute('alt') || '';
    const title = titleEl?.textContent?.trim() || link.getAttribute('aria-label') || imageAlt || '';

    card.__seerrMediaInfo = {
      link,
      href,
      mediaType: tmdbMatch[1],
      tmdbId: tmdbMatch[2],
      title: title.trim()
    };
    return card.__seerrMediaInfo;
  }

  function getMediaCards(root = document) {
    const titleCards = Array.from(root.querySelectorAll('[data-testid="title-card"]'))
      .filter(card => !card.closest('[data-seerr-overlay="true"]'));
    if (titleCards.length > 0) return titleCards;

    const links = Array.from(root.querySelectorAll('a[href]'))
      .filter(link => MEDIA_LINK_RE.test(link.getAttribute('href') || ''))
      .filter(link => !link.closest('[data-seerr-overlay="true"]'));
    const cards = [];
    const seen = new Set();

    links.forEach(link => {
      const card = link.closest(MEDIA_CARD_CONTAINER_SELECTOR) || link;
      if (!card || card.closest('[data-seerr-overlay="true"]')) return;
      if (seen.has(card)) return;
      seen.add(card);
      cards.push(card);
    });

    return cards;
  }

  function ensureCardIndexes(cards) {
    cards.forEach(card => {
      if (!card.hasAttribute('data-seerr-card-index')) {
        card.setAttribute('data-seerr-card-index', String(nextCardIndex++));
      }
    });
  }

  // Seerr renders title-card inside a <li>. Move the list item, never
  // detach the card from its React-owned wrapper or sort inside one item.
  function getCardLayoutItem(card) {
    const item = card.closest?.('li');
    return item && item.querySelectorAll('[data-testid="title-card"]').length === 1 ? item : card;
  }

  function getCardsGrid(cards = getMediaCards()) {
    return cards[0] ? getCardLayoutItem(cards[0]).parentElement : null;
  }

  function insertControlsBeforeGrid(bar, grid) {
    if (!grid?.parentElement) return false;
    grid.parentElement.insertBefore(bar, grid);
    return true;
  }

  // ──────────────── Injection ────────────────

  function injectCardBadges() {
    if (!FEATURE_FLAGS.cardBadges && !FEATURE_FLAGS.sortFilter) return;

    // Find media cards on discover/search pages
    const cards = getMediaCards();
    hydrateCardsFromListItems();
    const listEndpoint = getListRatingsEndpoint(detectRoute());
    if (cards.length > 0 && cards.some(card => !getCardMediaInfo(card)) && listEndpoint && !pageRatingsFetches.has(listEndpoint)) {
      indexCurrentListRatings().then(() => injectCardBadges());
    }
    ensureCardIndexes(cards);

    cards.forEach(card => {
      if (card.querySelector('[data-seerr-overlay="true"][class*="card-badge"], [data-seerr-overlay="true"][class*="audience-badge"]')) return;
      if (card.__seerrRatings) return;
      if (card.__seerrBadgesResolving) return; // already resolving, skip this pass

      // Try to extract title/TMDB ID from card
      const mediaInfo = getCardMediaInfo(card);
      if (!mediaInfo) return;

      // Ensure card has position relative for absolute positioning
      const computed = window.getComputedStyle(card);
      if (computed.position === 'static') {
        card.style.position = 'relative';
      }

      // Mark the card as "rating-resolution in progress" so a re-entrant
      // call (e.g. setTimeout 2s retry) doesn't queue a second
      // getRatings + DOM append for the same card.
      card.__seerrBadgesResolving = true;
      card.__seerrBadgesCleared = false;
      const generation = routeGeneration;

      // Resolve ratings asynchronously
      if (mediaInfo.tmdbId) {
        getRatings(mediaInfo.tmdbId, mediaInfo.title, null, mediaInfo.mediaType).then(bundle => {
          if (generation !== routeGeneration || !card.isConnected) return;
          // Re-check: a cleanup could have removed any previously-rendered
          // badges since this promise was queued.
          if (card.__seerrBadgesCleared) {
            card.__seerrBadgesResolving = false;
            return;
          }
          card.__seerrRatings = bundle;
          if (!bundle || !Model.hasAnyScore(bundle)) {
            card.__seerrBadgesResolving = false;
            return;
          }

          if (FEATURE_FLAGS.cardBadges) {
            if (bundle.rtCriticsScore !== null && bundle.confidence >= Config.confidenceThreshold) {
              const prefix = bundle.confidence < 1.0 && bundle.confidence >= Config.confidenceThreshold ? '~' : '';
              const badge = document.createElement('span');
              badge.className = 'seerr-card-badge';
              badge.setAttribute('data-seerr-overlay', 'true');
              badge.textContent = `🍅 ${prefix}${bundle.rtCriticsScore}%`;
              card.appendChild(badge);
            }
            if (bundle.rtAudienceScore !== null && bundle.confidence >= Config.confidenceThreshold) {
              const audienceBadge = document.createElement('span');
              audienceBadge.className = 'seerr-card-badge seerr-card-audience-badge';
              audienceBadge.setAttribute('data-seerr-overlay', 'true');
              audienceBadge.textContent = `🍿 ${bundle.confidence < 1 ? '~' : ''}${bundle.rtAudienceScore}%`;
              if (bundle.rtCriticsScore !== null || bundle.tmdbRating !== null) audienceBadge.style.top = '28px';
              card.appendChild(audienceBadge);
            }
            if ((bundle.rtCriticsScore === null || bundle.confidence < Config.confidenceThreshold) && bundle.tmdbRating !== null) {
              const tmdbBadge = document.createElement('span');
              tmdbBadge.className = 'seerr-card-badge seerr-card-tmdb-badge';
              tmdbBadge.setAttribute('data-seerr-overlay', 'true');
              tmdbBadge.textContent = `🎬 ${bundle.tmdbRating}/10`;
              card.appendChild(tmdbBadge);
            }
          }
          updateSortFilterCoverage();
          applyScoreFilters(getCardsGrid());
          injectSortFilterControls();
        }).catch(err => log('Card badge ratings failed:', err))
          .finally(() => {
            if (generation !== routeGeneration || !card.isConnected) return;
            card.__seerrBadgesResolving = false;
            updateSortFilterCoverage();
            applyScoreFilters(getCardsGrid());
            setTimeout(injectSortFilterControls, 100);
          });
      } else {
        card.__seerrBadgesResolving = false;
      }
    });
  }

  function injectDetailRatings() {
    if (!FEATURE_FLAGS.detailRatingsRow && !FEATURE_FLAGS.preRequestSummary) return;

    const route = detectRoute();
    if (!route || (route.type !== 'movie-detail' && route.type !== 'tv-detail')) return;

    // Find the title/overview block near the request action
    const titleBlock = document.querySelector('[class*="title"], [class*="Title"], h1');
    if (!titleBlock) return;

    const container = titleBlock.closest('[class*="header"], [class*="Header"], [class*="detail"], [class*="Detail"], [class*="media-page"], [data-testid]')
      || titleBlock.parentElement;
    if (!container) return;

    if (container.querySelector('[data-seerr-overlay="true"][class*="ratings-row"]')) return;

    // Extract TMDB ID from route
    const tmdbId = route.id;
    const title = document.querySelector('h1')?.textContent?.trim() || '';

    const mediaType = route.type === 'tv-detail' ? 'tv' : 'movie';
    const generation = routeGeneration;
    getRatings(tmdbId, title, null, mediaType).then(bundle => {
      if (generation !== routeGeneration || !container.isConnected) return;
      const currentRoute = detectRoute();
      if (currentRoute?.type !== route.type || currentRoute.id !== tmdbId) return;
      if (container.querySelector('.seerr-ratings-row, .seerr-quality-summary')) return;
      if (!bundle || !Model.hasAnyScore(bundle)) return;

      const row = document.createElement('div');
      row.className = 'seerr-ratings-row';
      row.setAttribute('data-seerr-overlay', 'true');

      let hasRowContent = false;

      if (FEATURE_FLAGS.detailRatingsRow) {
        if (bundle.rtCriticsScore !== null && bundle.confidence >= Config.confidenceThreshold) {
          const prefix = bundle.confidence < 1.0 ? '~' : '';
          row.appendChild(makeRatingItem('🍅', `${prefix}${bundle.rtCriticsScore}%`, 'Tomatometer'));
          hasRowContent = true;
        }
        if (bundle.rtAudienceScore !== null && bundle.confidence >= Config.confidenceThreshold) {
          row.appendChild(makeRatingItem('🍿', `${bundle.confidence < 1 ? '~' : ''}${bundle.rtAudienceScore}%`, 'Audience'));
          hasRowContent = true;
        }
        if (bundle.imdbRating !== null) {
          row.appendChild(makeRatingItem('⭐', `${bundle.imdbRating}/10`, 'IMDb'));
          hasRowContent = true;
        }
        if (bundle.tmdbRating !== null) {
          row.appendChild(makeRatingItem('🎬', `${bundle.tmdbRating}/10`, 'TMDB'));
          hasRowContent = true;
        }
      }

      if (hasRowContent) {
        container.appendChild(row);
      }

      // Pre-request quality summary
      if (FEATURE_FLAGS.preRequestSummary) {
        const summary = buildSummary(bundle);
        if (summary) {
          const summaryEl = document.createElement('div');
          summaryEl.className = 'seerr-quality-summary';
          summaryEl.setAttribute('data-seerr-overlay', 'true');
          summaryEl.textContent = summary;
          container.appendChild(summaryEl);
        }
      }
    }).catch(err => log('Detail ratings failed:', err));
  }

  function makeRatingItem(icon, value, label) {
    const item = document.createElement('span');
    item.className = 'seerr-rating-item';
    const strong = document.createElement('strong');
    strong.textContent = value;
    const small = document.createElement('small');
    small.textContent = label;
    item.append(icon + ' ', strong, ' ', small);
    return item;
  }

  let injectionInProgress = false;
  let seerrDomReadyRetries = 0;
  const MAX_SEERR_DOM_RETRIES = 5;
  let cardObserver = null;
  let cardObserverTimer = null;

  function isSeerrPage() {
    // Content-script matches must cover self-hosted servers, but generic
    // Next.js markup is not proof that a page belongs to the user's Seerr.
    if (!configuredServer || configuredServer.origin !== window.location.origin) return false;
    const basePath = configuredServer.pathname.replace(/\/+$/, '');
    return !basePath || window.location.pathname === basePath || window.location.pathname.startsWith(`${basePath}/`);
  }

  function injectOverlay() {
    if (isAlreadyInjected()) return;
    if (injectionInProgress) return;

    if (!isSeerrPage()) {
      if (seerrDomReadyRetries < MAX_SEERR_DOM_RETRIES) {
        seerrDomReadyRetries++;
        setTimeout(injectOverlay, 1000);
        return;
      }
      return;
    }

    injectionInProgress = true;

    try {
      const route = detectRoute();
      log(`Route detected: ${route ? route.type : 'unsupported'}`);

      if (!route) return;

      if (isListRoute(route)) {
        injectCardBadges();
        injectSortFilterControls();
        setupCardObserver();
        setTimeout(() => injectCardBadges(), 2000); // retry for lazy-loaded cards
      } else if (route.type === 'movie-detail' || route.type === 'tv-detail') {
        injectDetailRatings();
      }
    } finally {
      injectionInProgress = false;
    }
  }

  function setupCardObserver() {
    if (cardObserver || !window.MutationObserver) return;
    cardObserver = new MutationObserver(() => {
      const route = detectRoute();
      if (!isListRoute(route)) return;
      clearTimeout(cardObserverTimer);
      cardObserverTimer = setTimeout(() => {
        injectCardBadges();
        injectSortFilterControls();
      }, 250);
    });
    cardObserver.observe(document.body, { childList: true, subtree: true });
  }

  // ──────────────── Sort & Filter ────────────────

  function countCardsWithRatings(cards = getMediaCards()) {
    if (cards.length === 0) return { total: 0, rated: 0 };
    let rated = 0;
    cards.forEach(c => { if (getCardAnyScore(c) !== null) rated++; });
    return { total: cards.length, rated };
  }

  function updateSortFilterCoverage() {
    const bar = document.getElementById('seerr-filter-bar');
    if (!bar) return;
    const coverageEl = bar.querySelector('.seerr-score-coverage');
    if (!coverageEl) return;
    const grid = bar.nextElementSibling || bar.parentElement;
    const cards = getMediaCards(grid);
    const total = cards.length;
    const scored = cards.filter(c => getCardAnyScore(c) !== null).length;
    const hidden = cards.filter(c => c.style.display === 'none').length;
    const visible = total - hidden;
    coverageEl.textContent = `${scored}/${total} scored${hidden > 0 ? ` · ${visible} visible` : ''}`;
  }

  let currentSort = 'default';

  function applyScoreSort(grid, order = currentSort) {
    if (!grid) return;
    const currentCards = getMediaCards(grid);
    ensureCardIndexes(currentCards);
    const originalIndex = card => Number(card.getAttribute('data-seerr-card-index')) || 0;
    const score = card => order.startsWith('rt-audience') ? getCardAudienceScore(card)
      : order.startsWith('tmdb') ? getCardTmdbScore(card)
      : order.startsWith('imdb') ? getCardImdbScore(card)
      : order.startsWith('score') ? getCardAnyScore(card) : getCardScore(card);
    const visible = currentCards.filter(c => c.style.display !== 'none');
    const hidden = currentCards.filter(c => c.style.display === 'none');
    const compare = (a, b) => {
      const tie = originalIndex(a) - originalIndex(b);
      if (order === 'default') return tie;
      const sa = score(a), sb = score(b);
      if (sa === null && sb === null) return tie;
      if (sa === null) return 1;
      if (sb === null) return -1;
      return (order.endsWith('-asc') ? sa - sb : sb - sa) || tie;
    };
    const ordered = order === 'default'
      ? [...currentCards].sort(compare)
      : [...visible.sort(compare), ...hidden.sort((a, b) => originalIndex(a) - originalIndex(b))];
    // Avoid triggering a MutationObserver loop when the order is unchanged.
    if (ordered.every((card, index) => card === currentCards[index])) return;
    ordered.forEach(card => grid.appendChild(getCardLayoutItem(card)));
  }

  const currentFilters = {
    minCritics: 0,
    minAudience: 0,
    minTmdb: 0,
    minImdb: 0
  };

  function applyScoreFilters(grid, filters = currentFilters) {
    if (!grid) return;
    const currentCards = getMediaCards(grid);
    ensureCardIndexes(currentCards);
    currentCards.forEach(c => {
      const cs = getCardScore(c);
      const as = getCardAudienceScore(c);
      const ts = getCardTmdbScore(c);
      const is = getCardImdbScore(c);
      const hidesForCritics = filters.minCritics > 0 && (cs === null || cs < filters.minCritics);
      const hidesForAudience = filters.minAudience > 0 && (as === null || as < filters.minAudience);
      const hidesForTmdb = filters.minTmdb > 0 && (ts === null || ts < filters.minTmdb);
      const hidesForImdb = filters.minImdb > 0 && (is === null || is < filters.minImdb);
      c.style.display = (hidesForCritics || hidesForAudience || hidesForTmdb || hidesForImdb) ? 'none' : '';
      getCardLayoutItem(c).style.display = c.style.display;
    });
    applyScoreSort(grid);
  }

  function toggleFilterBar() {
    const bar = document.getElementById('seerr-filter-bar');
    const toggle = document.getElementById('seerr-filter-toggle');
    if (!bar) return;
    if (bar.style.display === 'none') {
      bar.style.display = '';
      if (toggle) toggle.textContent = '🔽 Hide';
    } else {
      bar.style.display = 'none';
      if (toggle) toggle.textContent = '🔼 Sort & Filter';
    }
  }

  function ensureFilterToggle() {
    if (document.getElementById('seerr-filter-toggle')) return;
    const toggle = document.createElement('button');
    toggle.id = 'seerr-filter-toggle';
    toggle.className = 'seerr-filter-toggle';
    toggle.setAttribute('data-seerr-overlay', 'true');
    toggle.textContent = '🔽 Hide';
    toggle.addEventListener('click', toggleFilterBar);
    document.body.appendChild(toggle);
  }

  function injectSortFilterControls(retryCount = 0) {
    if (!isSeerrPage()) return;
    if (!FEATURE_FLAGS.sortFilter) return;

    const route = detectRoute();
    if (!isListRoute(route)) return;

    // Ensure the toggle button exists even if the bar hasn't been injected yet
    ensureFilterToggle();

    if (document.querySelector('[data-seerr-overlay="true"][class*="sort-filter-bar"]')) {
      applyScoreSort(getCardsGrid());
      return;
    }

    const cards = getMediaCards();
    if (cards.length === 0) return;
    ensureCardIndexes(cards);

    const { total, rated } = countCardsWithRatings(cards);

    const bar = document.createElement('div');
    bar.className = 'seerr-sort-filter-bar';
    bar.setAttribute('data-seerr-overlay', 'true');
    bar.id = 'seerr-filter-bar';

    bar.innerHTML = `
      <span class="seerr-score-coverage">${rated}/${total} scored</span>
      <span class="seerr-cache-age" title="Cached scores never expire; refresh to refetch the titles on this page"></span>
      <label for="seerr-sort-order">Sort titles</label>
      <select id="seerr-sort-order" class="seerr-sort-select">
        <option value="default">Original order</option>
        <option value="score-desc">Best Score ↓</option>
        <option value="score-asc">Best Score ↑</option>
        <option value="rt-critics-desc">🍅 RT critics: highest first</option>
        <option value="rt-critics-asc">🍅 RT critics: lowest first</option>
        <option value="rt-audience-desc">🍿 RT audience: highest first</option>
        <option value="rt-audience-asc">🍿 RT audience: lowest first</option>
        <option value="tmdb-desc">🎬 TMDB ↓</option>
        <option value="tmdb-asc">🎬 TMDB ↑</option>
        <option value="imdb-desc">⭐ IMDb ↓</option>
        <option value="imdb-asc">⭐ IMDb ↑</option>
      </select>
      <label>Critics ≥</label>
      <input type="number" class="seerr-min-critics" min="0" max="100" step="5" value="0" style="width:55px">
      <label>Audience ≥</label>
      <input type="number" class="seerr-min-audience" min="0" max="100" step="5" value="0" style="width:55px">
      <label>TMDB ≥</label>
      <input type="number" class="seerr-min-tmdb" min="0" max="10" step="0.5" value="0" style="width:55px">
      <label>IMDb ≥</label>
      <input type="number" class="seerr-min-imdb" min="0" max="10" step="0.5" value="0" style="width:55px">
      <button class="seerr-reset-sort">Reset</button>
      <button class="seerr-refresh-scores" title="Refetch scores for the titles loaded on this page">Refresh scores</button>
      ${FEATURE_FLAGS.bulkActions && apiConfigured ? '<button class="seerr-toggle-select" data-seerr-overlay="true">Select titles</button>' : ''}
    `;

    const grid = getCardsGrid(cards);
    if (!grid || !insertControlsBeforeGrid(bar, grid)) return;

    function updateCoverage() {
      const coverageEl = bar.querySelector('.seerr-score-coverage');
      if (!coverageEl) return;
      const current = countCardsWithRatings(getMediaCards(grid));
      coverageEl.textContent = `${current.rated}/${current.total} scored`;
      updateCacheAge();
    }

    function updateCacheAge() {
      const ageEl = bar.querySelector('.seerr-cache-age');
      if (!ageEl) return;
      ageEl.textContent = describeCacheAge(ratingsCacheAge(loadedTitles(grid)));
    }

    // Wire toggle button immediately (BUG 5 fix)
    const toggleBtn = bar.querySelector('.seerr-toggle-select');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', toggleBulkMode);
    }

    // ── Sort logic ──
    const sortSelect = bar.querySelector('.seerr-sort-select');
    sortSelect.addEventListener('change', () => {
      currentSort = sortSelect.value;
      applyScoreSort(grid);
      updateCoverage();
    });

    // ── Reset ──
    bar.querySelector('.seerr-reset-sort').addEventListener('click', () => {
      // Restore original order by re-appending in source order
      const allCards = getMediaCards(grid);
      ensureCardIndexes(allCards);
      const ordered = allCards.sort((a, b) => {
        const idxA = parseInt(a.getAttribute('data-seerr-card-index') || '0');
        const idxB = parseInt(b.getAttribute('data-seerr-card-index') || '0');
        return idxA - idxB;
      });
      ordered.forEach(c => {
        c.style.display = '';
        getCardLayoutItem(c).style.display = '';
        grid.appendChild(getCardLayoutItem(c));
      });
      currentSort = 'default';
      sortSelect.value = 'default';
      bar.querySelector('.seerr-min-critics').value = '0';
      bar.querySelector('.seerr-min-audience').value = '0';
      bar.querySelector('.seerr-min-tmdb').value = '0';
      bar.querySelector('.seerr-min-imdb').value = '0';
      currentFilters.minCritics = 0;
      currentFilters.minAudience = 0;
      currentFilters.minTmdb = 0;
      currentFilters.minImdb = 0;
      updateCoverage();
    });

    // Store original index on each card
    ensureCardIndexes(cards);

    // ── Refresh ──
    bar.querySelector('.seerr-refresh-scores').addEventListener('click', async event => {
      const button = event.currentTarget;
      if (button.disabled) return;
      const label = button.textContent;
      button.disabled = true;
      button.textContent = 'Refreshing...';
      try {
        await refreshLoadedScores(grid);
      } finally {
        button.disabled = false;
        button.textContent = label;
        updateCoverage();
      }
    });

    // ── Filter logic ──
    function applyFilters() {
      currentFilters.minCritics = parseInt(bar.querySelector('.seerr-min-critics').value, 10) || 0;
      currentFilters.minAudience = parseInt(bar.querySelector('.seerr-min-audience').value, 10) || 0;
      currentFilters.minTmdb = parseFloat(bar.querySelector('.seerr-min-tmdb').value) || 0;
      currentFilters.minImdb = parseFloat(bar.querySelector('.seerr-min-imdb').value) || 0;
      applyScoreFilters(grid);
      updateCoverage();
    }

    bar.querySelector('.seerr-min-critics').addEventListener('input', applyFilters);
    bar.querySelector('.seerr-min-audience').addEventListener('input', applyFilters);
    bar.querySelector('.seerr-min-tmdb').addEventListener('input', applyFilters);
    bar.querySelector('.seerr-min-imdb').addEventListener('input', applyFilters);

    if (retryCount < 5) {
      setTimeout(() => {
        updateCoverage();
        if (countCardsWithRatings(getMediaCards(grid)).rated === 0) {
          injectCardBadges();
        }
      }, 1000 + retryCount * 1000);
    }
  }

  function getCardScore(card) {
    if (card.__seerrRatings) return card.__seerrRatings.confidence >= Config.confidenceThreshold ? card.__seerrRatings.rtCriticsScore : null;
    const badge = card.querySelector('.seerr-card-badge');
    if (!badge) return null;
    const match = badge.textContent.match(/🍅\s*~?(\d+)%/);
    return match ? parseInt(match[1]) : null;
  }

  function getCardAudienceScore(card) {
    if (card.__seerrRatings) return card.__seerrRatings.confidence >= Config.confidenceThreshold ? card.__seerrRatings.rtAudienceScore : null;
    const badge = card.querySelector('.seerr-card-audience-badge');
    if (!badge) return null;
    const match = badge.textContent.match(/🍿\s*~?(\d+)%/);
    return match ? parseInt(match[1]) : null;
  }

  function getCardTmdbScore(card) {
    if (card.__seerrRatings) return card.__seerrRatings.tmdbRating;
    const badge = card.querySelector('.seerr-card-tmdb-badge');
    if (!badge) return null;
    const match = badge.textContent.match(/🎬\s*(\d+(?:\.\d+)?)\/10/);
    return match ? parseFloat(match[1]) : null;
  }

  // Unlike the others there is no card badge to fall back on, so this reads
  // the resolved bundle only. Confidence gates RT title matching, not IMDb.
  function getCardImdbScore(card) {
    return card.__seerrRatings ? card.__seerrRatings.imdbRating : null;
  }

  function getCardAnyScore(card) {
    const critics = getCardScore(card);
    if (critics !== null) return critics;
    const audience = getCardAudienceScore(card);
    if (audience !== null) return audience;
    const tmdb = getCardTmdbScore(card);
    if (tmdb !== null) return tmdb * 10;
    const imdb = getCardImdbScore(card);
    return imdb !== null ? imdb * 10 : null;
  }

  // ──────────────── Bulk List Actions ────────────────

  let bulkMode = false;
  let selectedCards = new Set();

  function toggleBulkMode() {
    if (!FEATURE_FLAGS.bulkActions || !apiConfigured) return;

    bulkMode = !bulkMode;
    selectedCards.clear();

    const cards = getMediaCards();
    ensureCardIndexes(cards);

    if (bulkMode) {
      cards.forEach(card => {
        if (card.querySelector('.seerr-select-checkbox')) return;

        const computed = window.getComputedStyle(card);
        if (computed.position === 'static') card.style.position = 'relative';

        const checkbox = document.createElement('button');
        checkbox.type = 'button';
        checkbox.className = 'seerr-select-checkbox';
        checkbox.setAttribute('role', 'checkbox');
        checkbox.setAttribute('aria-checked', 'false');
        checkbox.setAttribute('aria-label', `Select ${getCardMediaInfo(card)?.title || 'title'}`);
        checkbox.setAttribute('data-seerr-overlay', 'true');
        checkbox.addEventListener('click', (e) => {
          e.stopPropagation();
          if (selectedCards.has(card)) {
            selectedCards.delete(card);
            checkbox.classList.remove('checked');
            checkbox.setAttribute('aria-checked', 'false');
          } else {
            selectedCards.add(card);
            checkbox.classList.add('checked');
            checkbox.setAttribute('aria-checked', 'true');
          }
          updateBulkActionBar();
        });
        card.appendChild(checkbox);
      });

      showBulkActionBar();
      updateBulkActionBar();

      const toggleBtn = document.querySelector('.seerr-toggle-select');
      if (toggleBtn) toggleBtn.textContent = 'Cancel selection';
    } else {
      document.querySelectorAll('.seerr-select-checkbox').forEach(el => el.remove());
      hideBulkActionBar();

      const toggleBtn = document.querySelector('.seerr-toggle-select');
      if (toggleBtn) toggleBtn.textContent = 'Select titles';
    }
  }

  let bulkActionBar = null;

  function showBulkActionBar() {
    if (bulkActionBar) return;
    bulkActionBar = document.createElement('div');
    bulkActionBar.className = 'seerr-bulk-action-bar';
    bulkActionBar.setAttribute('data-seerr-overlay', 'true');
    bulkActionBar.innerHTML = `
      <span class="seerr-bulk-count">0 selected</span>
      <button class="seerr-bulk-review">Review & Request</button>
      <button class="seerr-bulk-cancel">Cancel</button>
    `;
    document.body.appendChild(bulkActionBar);

    bulkActionBar.querySelector('.seerr-bulk-review').addEventListener('click', openBulkConfirmation);
    bulkActionBar.querySelector('.seerr-bulk-cancel').addEventListener('click', toggleBulkMode);
  }

  function hideBulkActionBar() {
    if (bulkActionBar) { bulkActionBar.remove(); bulkActionBar = null; }
  }

  function updateBulkActionBar() {
    if (!bulkActionBar) return;
    const countEl = bulkActionBar.querySelector('.seerr-bulk-count');
    if (countEl) countEl.textContent = `${selectedCards.size} selected`;
  }

  function getSelectedTitles() {
    const titles = [];
    selectedCards.forEach(card => {
      if (!card) return;
      const mediaInfo = getCardMediaInfo(card);
      const score = getCardScore(card);
      titles.push({
        title: mediaInfo?.title || 'Unknown Title',
        tmdbId: mediaInfo?.tmdbId || null,
        mediaType: mediaInfo?.mediaType || 'movie',
        score
      });
    });
    return titles;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function isRequestableTitle(title) {
    return /^\d+$/.test(String(title.tmdbId || '')) && Number(title.tmdbId) > 0 &&
      (title.mediaType === 'movie' || title.mediaType === 'tv');
  }

  function openBulkConfirmation() {
    if (selectedCards.size === 0 || document.querySelector('.seerr-confirmation-modal')) return;

    const titles = getSelectedTitles();
    // Ratings are optional context. Request eligibility depends on a media
    // identity; Seerr remains responsible for permissions and approval.
    const readyTitles = titles.filter(isRequestableTitle);
    const excludedTitles = titles.filter(title => !isRequestableTitle(title));

    const modal = document.createElement('div');
    modal.className = 'seerr-confirmation-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Review your bulk request');
    modal.setAttribute('data-seerr-overlay', 'true');
    modal.innerHTML = `
      <h3>Review your bulk request</h3>
      <div style="margin-bottom:12px">
        <strong style="color:#10b981">✅ ${readyTitles.length} titles ready to request</strong>
        ${excludedTitles.length > 0 ? `<br><strong style="color:#f59e0b">⚠️ ${excludedTitles.length} titles excluded</strong>` : ''}
      </div>
      <ul>
        ${readyTitles.map(t => `<li>• ${escapeHtml(t.title)}</li>`).join('')}
      </ul>
      ${excludedTitles.length > 0 ? `
        <details style="margin-bottom:12px;opacity:0.7">
          <summary>Excluded titles (${excludedTitles.length})</summary>
          <ul>
            ${excludedTitles.map(t => `<li class="excluded">• ${escapeHtml(t.title)} (missing or invalid media identity)</li>`).join('')}
          </ul>
        </details>
      ` : ''}
      <div class="modal-actions">
        <button class="cancel-btn">Cancel</button>
        <button class="confirm-btn">Request ${readyTitles.length} titles</button>
      </div>
    `;

    document.body.appendChild(modal);

    const previousFocus = document.activeElement;
    const closeModal = () => { modal.remove(); previousFocus?.focus(); };
    modal.querySelector('.cancel-btn').addEventListener('click', closeModal);
    modal.querySelector('.cancel-btn').focus();
    modal.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); closeModal(); }
      if (event.key === 'Tab') {
        const controls = [...modal.querySelectorAll('button:not(:disabled), summary')];
        const index = controls.indexOf(document.activeElement);
        if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1)?.focus(); }
        else if (!event.shiftKey && index === controls.length - 1) { event.preventDefault(); controls[0]?.focus(); }
      }
    });

    modal.querySelector('.confirm-btn').addEventListener('click', async () => {
      if (!apiConfigured) {
        modal.querySelector('.confirm-btn').textContent = 'API key required — configure in extension settings';
        modal.querySelector('.confirm-btn').style.background = '#ef4444';
        return;
      }
      const btn = modal.querySelector('.confirm-btn');
      if (btn.disabled) return;
      const generation = routeGeneration;
      btn.disabled = true;
      btn.textContent = 'Requesting...';

      let succeeded = 0;
      let failed = 0;
      const BULK_REQUEST_DELAY_MS = 500;

      for (let i = 0; i < readyTitles.length; i++) {
        if (!modal.isConnected || generation !== routeGeneration) return;
        const t = readyTitles[i];
        btn.textContent = `Requesting ${i + 1}/${readyTitles.length}...`;
        const tmdbIdNum = parseInt(t.tmdbId, 10);
        if (!t.tmdbId || Number.isNaN(tmdbIdNum)) {
          failed++;
          continue;
        }
        try {
          const response = await chrome.runtime.sendMessage({
            action: 'requestMedia',
            data: { title: t.title, mediaType: t.mediaType, tmdbId: tmdbIdNum }
          });
          if (response && response.success) {
            succeeded++;
          } else {
            failed++;
          }
        } catch (_) {
          failed++;
        }
        if (i < readyTitles.length - 1) {
          await new Promise(r => setTimeout(r, BULK_REQUEST_DELAY_MS));
        }
      }

      if (!modal.isConnected || generation !== routeGeneration) return;
      closeModal();
      hideBulkActionBar();

      const summary = document.createElement('div');
      summary.className = 'seerr-notification success';
      summary.setAttribute('data-seerr-overlay', 'true');
      summary.innerHTML = `
        <div class="seerr-notification-title">Bulk Request Complete</div>
        <div class="seerr-notification-message">${succeeded} succeeded${failed > 0 ? `, ${failed} failed` : ''}</div>
      `;
      document.body.appendChild(summary);
      setTimeout(() => summary.remove(), 5000);

      bulkMode = false;
      selectedCards.clear();
      document.querySelectorAll('.seerr-select-checkbox').forEach(el => el.remove());
    });
  }

  // ──────────────── Bootstrap ────────────────

  // ──────────────── Debug ────────────────

  if (!window.seerr_debug) window.seerr_debug = {};
  window.seerr_debug.ratings = {
    enable:       () => { debugMode = true; console.log('🍅 [Seerr Overlay] Debug enabled'); },
    disable:      () => { debugMode = false; },
    cache:        () => ratingsCache,
    currentRoute: () => detectRoute(),
    diagnose:     () => {
      const route = detectRoute();
      const cards = getMediaCards();
      return {
        url: window.location.href,
        route,
        isSeerrPage: isSeerrPage(),
        cardCount: cards.length,
        ratedCount: countCardsWithRatings(cards).rated,
        listEndpoint: getListRatingsEndpoint(route),
        // The page-world observer cannot be inspected from here, so report
        // what it has actually delivered instead.
        observed: {
          messages: observedStats.messages,
          items: observedStats.items,
          rejected: observedStats.rejected,
          lastAt: observedStats.lastAt,
          byPath: Object.fromEntries(observedStats.byUrl)
        },
        listItems: lastListItems.length,
        cachedTitles: resolvedCacheSize(),
        unresolvedCards: explainUnresolvedCards(),
        sampleCards: cards.slice(0, 5).map(card => ({
          media: getCardMediaInfo(card),
          critics: getCardScore(card),
          audience: getCardAudienceScore(card),
          tmdb: getCardTmdbScore(card),
          imdb: getCardImdbScore(card)
        }))
      };
    },
    clearCache:   () => { forgetPersistedRatings(); chrome.storage.local.remove([PERSISTED_RATINGS_KEY]); },
    inject:       () => { cleanupOverlay(); injectOverlay(); },
    reInject:     () => { cleanupOverlay(); injectOverlay(); }
  };

  // ──────────────── Bootstrap ────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(injectOverlay, 500));
  } else {
    setTimeout(injectOverlay, 500);
  }

  // Retry for dynamic content
  setTimeout(() => {
    injectOverlay();
    injectSortFilterControls();
  }, 2000);
})();

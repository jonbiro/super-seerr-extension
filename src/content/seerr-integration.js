// Seerr Pre-Request Ratings Overlay
// Injects Rotten Tomatoes context on Seerr browse cards and detail pages.
// Prefers Seerr-native ratings data; falls back to confidence-aware resolution.
// The request flow remains visually primary throughout.

(function () {
  if (window.__seerr_overlay_installed) return;
  window.__seerr_overlay_installed = true;

  const Model = window.RatingsModel;
  const Config = window.RatingsConfig;
  if (!Model || !Config) return;

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

  // Check API config — controls whether request features are available
  function checkApiConfig() {
    chrome.storage.sync.get(['seerrUrl', 'seerrApiKey']).then(settings => {
      apiConfigured = !!(settings.seerrUrl && settings.seerrApiKey);
      log('API configured:', apiConfigured);
    });
  }
  checkApiConfig();

  // Update when settings change (e.g., user configures from options page)
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && (changes.seerrUrl || changes.seerrApiKey)) {
      checkApiConfig();
    }
  });

  const ratingsCache = new Map(); // key: tmdbId (string), value: { bundle, expiresAt }
  const embeddedRatingsByTmdbId = new Map();
  let embeddedRatingsIndexed = false;

  // ──────────────── Route Detection ────────────────

  function detectRoute() {
    const path = window.location.pathname;
    if (/^\/movie\/\d+/.test(path)) return { type: 'movie-detail', id: path.match(/\/movie\/(\d+)/)[1] };
    if (/^\/tv\/\d+/.test(path))    return { type: 'tv-detail',    id: path.match(/\/tv\/(\d+)/)[1] };
    if (/^\/search/.test(path))     return { type: 'search' };
    if (/^\/discover/.test(path))   return { type: 'discover' };
    if (/^\/requests(?:\/|$)/.test(path)) return { type: 'requests' };
    if (path === '/')               return { type: 'discover' };
    return null;
  }

  function isListRoute(route) {
    return route && (route.type === 'discover' || route.type === 'search' || route.type === 'requests');
  }

  // ──────────────── SPA Navigation ────────────────

  let currentPath = window.location.pathname;
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

  function handleRouteChange() {
    if (window.location.pathname === currentPath) return;
    currentPath = window.location.pathname;
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
    document.querySelectorAll('[data-seerr-overlay="true"]').forEach(el => el.remove());
    embeddedRatingsByTmdbId.clear();
    embeddedRatingsIndexed = false;
    // Reset pending badge flags so cards can be re-injected after navigation
    document.querySelectorAll('[class*="card"], [class*="Card"]').forEach(c => { c.__seerrBadgesResolving = false; });
    // Clear the per-card in-progress flag so a future re-injection isn't
    // permanently blocked by a stale marker.
    document.querySelectorAll('[class*="card"], [class*="Card"], [class*="media-item"], [class*="MediaCard"]').forEach(card => {
      card.__seerrBadgesResolving = false;
      card.__seerrBadgesCleared = true;
    });
  }

  // ──────────────── Ratings Resolution ────────────────

  function parsePercentScore(value) {
    if (value === null || value === undefined || value === '') return null;
    const raw = typeof value === 'number' ? value : parseFloat(String(value).match(/\d+(?:\.\d+)?/)?.[0]);
    if (!Number.isFinite(raw)) return null;
    return Math.max(0, Math.min(100, Math.round(raw)));
  }

  function parseTenPointScore(value) {
    if (value === null || value === undefined || value === '') return null;
    const raw = typeof value === 'number' ? value : parseFloat(String(value).match(/\d+(?:\.\d+)?/)?.[0]);
    if (!Number.isFinite(raw)) return null;
    return Math.max(0, Math.min(10, Math.round(raw * 10) / 10));
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

  function mergeBundles(primary, secondary) {
    if (!primary) return secondary || null;
    if (!secondary) return primary;
    return Model.createRatingsBundle({
      rtCriticsScore: primary.rtCriticsScore ?? secondary.rtCriticsScore,
      rtAudienceScore: primary.rtAudienceScore ?? secondary.rtAudienceScore,
      imdbRating: primary.imdbRating ?? secondary.imdbRating,
      tmdbRating: primary.tmdbRating ?? secondary.tmdbRating,
      confidence: Math.max(primary.confidence || 0, secondary.confidence || 0),
      source: primary.source || secondary.source,
      lastUpdated: Math.max(primary.lastUpdated || 0, secondary.lastUpdated || 0) || Date.now()
    });
  }

  function objectTmdbId(obj) {
    if (!obj || typeof obj !== 'object') return null;
    return obj.tmdbId ?? obj.id ?? obj.mediaInfo?.tmdbId ?? obj.media?.tmdbId ?? obj.media?.id ?? null;
  }

  function indexEmbeddedRatings() {
    if (embeddedRatingsIndexed) return;
    embeddedRatingsIndexed = true;

    const scripts = document.querySelectorAll('script[type="application/json"], script#__NEXT_DATA__');
    const seen = new WeakSet();

    function visit(node) {
      if (!node || typeof node !== 'object' || seen.has(node)) return;
      seen.add(node);

      const tmdbId = objectTmdbId(node);
      if (tmdbId !== null && tmdbId !== undefined) {
        let bundle = bundleFromRatingObject(node, 'seerr-native');
        bundle = mergeBundles(bundle, bundleFromRatingObject(node.mediaInfo, 'seerr-native'));
        bundle = mergeBundles(bundle, bundleFromRatingObject(node.media, 'seerr-native'));
        if (bundle && Model.hasAnyScore(bundle)) {
          const key = String(tmdbId);
          embeddedRatingsByTmdbId.set(key, mergeBundles(embeddedRatingsByTmdbId.get(key), bundle));
        }
      }

      if (Array.isArray(node)) {
        node.forEach(visit);
      } else {
        Object.keys(node).forEach(key => visit(node[key]));
      }
    }

    scripts.forEach(script => {
      try {
        visit(JSON.parse(script.textContent));
      } catch (_) {}
    });
  }

  function extractSeerrNativeRatings(tmdbId = null) {
    const bundle = {};

    // Look for embedded JSON data (e.g., __NEXT_DATA__ or similar)
    const scripts = document.querySelectorAll('script[type="application/json"]');
    scripts.forEach(script => {
      try {
        const data = JSON.parse(script.textContent);
        const direct = bundleFromRatingObject(data?.props?.pageProps?.media, 'seerr-native');
        if (direct) Object.assign(bundle, direct);
        // Seerr typically embeds media data in various shapes
        if (data?.props?.pageProps?.media) {
          const m = data.props.pageProps.media;
          if (m.rtCriticsScore != null) bundle.rtCriticsScore = parseInt(m.rtCriticsScore);
          if (m.rtAudienceScore != null) bundle.rtAudienceScore = parseInt(m.rtAudienceScore);
          if (m.voteAverage != null) bundle.tmdbRating = parseFloat(m.voteAverage);
          if (m.imdbRating != null) bundle.imdbRating = parseFloat(m.imdbRating);
        }
      } catch (_) {}
    });

    if (tmdbId !== null && tmdbId !== undefined) {
      indexEmbeddedRatings();
      const embedded = embeddedRatingsByTmdbId.get(String(tmdbId));
      if (embedded && Model.hasAnyScore(embedded)) return embedded;
    }

    // Try to extract from the DOM (ratings may be rendered as text)
    const rtElements = document.querySelectorAll('[data-rating], .rt-score');
    rtElements.forEach(el => {
      const text = el.textContent.trim();
      const scoreMatch = text.match(/(\d+)%/);
      if (scoreMatch && !bundle.rtCriticsScore) {
        bundle.rtCriticsScore = parseInt(scoreMatch[1]);
      }
    });

    if (Object.keys(bundle).length > 0) {
      bundle.confidence = 1.0;
      bundle.source = 'seerr-native';
      bundle.lastUpdated = Date.now();
    }

    return Object.keys(bundle).length > 0 ? Model.createRatingsBundle(bundle) : null;
  }

  async function fetchJsonFromSeerr(endpoint) {
    const url = new URL(endpoint, window.location.origin);
    const response = await fetch(url.toString(), {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' }
    });

    if (!response.ok) {
      log(`Seerr ratings endpoint ${endpoint} returned ${response.status}`);
      return null;
    }

    return response.json();
  }

  async function fetchSeerrSessionRatings(tmdbId, mediaType) {
    if (!tmdbId || !mediaType) return null;

    const endpoints = mediaType === 'tv'
      ? [`/api/v1/tv/${tmdbId}/ratings`, `/api/v1/tv/${tmdbId}`]
      : [`/api/v1/movie/${tmdbId}/ratingscombined`, `/api/v1/movie/${tmdbId}/ratings`, `/api/v1/movie/${tmdbId}`];

    let bundle = null;
    for (const endpoint of endpoints) {
      try {
        const data = await fetchJsonFromSeerr(endpoint);
        const next = bundleFromRatingObject(data, endpoint.includes('ratings') ? 'seerr-ratings-api' : 'seerr-details-api');
        bundle = mergeBundles(bundle, next);
      } catch (error) {
        log(`Seerr ratings fetch failed for ${endpoint}:`, error);
      }
    }

    return bundle && Model.hasAnyScore(bundle) ? bundle : null;
  }

  async function resolveRatings(tmdbId, title, year, mediaType = null) {
    log(`Resolving ratings for TMDB ${tmdbId}`);

    // 1. Check Seerr-native data first
    const native = extractSeerrNativeRatings(tmdbId);
    if (native && native.rtCriticsScore !== null) {
      log('Using Seerr-native ratings, confidence 1.0');
      return native;
    }

    // 2. If we have native data with some fields, use it as base
    if (native && Model.hasAnyScore(native)) {
      log('Using partial Seerr-native ratings');
      return native;
    }

    // 3. Same-origin Seerr API lookup using the user's logged-in page session.
    // This does not need the extension's stored Seerr API key.
    const sessionRatings = await fetchSeerrSessionRatings(tmdbId, mediaType);
    if (sessionRatings && Model.hasAnyScore(sessionRatings)) {
      log('Using same-origin Seerr ratings API');
      return mergeBundles(sessionRatings, native);
    }

    const fallback = Model.createRatingsBundle({
      confidence: native ? 1.0 : 0.0,
      source: native ? 'seerr-native' : 'unknown',
      lastUpdated: Date.now()
    });

    return fallback;
  }

  async function getRatings(tmdbId, title, year, mediaType = null) {
    const key = String(tmdbId || title);
    const cached = ratingsCache.get(key);
    if (cached && Date.now() < cached.expiresAt) {
      log(`Cache hit for ${key}`);
      return cached.bundle;
    }

    // Coalesce concurrent requests
    const pendingKey = `pending:${key}`;
    if (ratingsCache.has(pendingKey)) {
      log(`Coalescing request for ${key}`);
      return ratingsCache.get(pendingKey);
    }

    const promise = resolveRatings(tmdbId, title, year, mediaType);
    ratingsCache.set(pendingKey, promise);

    try {
      const bundle = await promise;
      if (bundle) {
        ratingsCache.set(key, { bundle, expiresAt: Date.now() + Config.cacheTtlMs });
      }
      return bundle;
    } finally {
      ratingsCache.delete(pendingKey);
    }
  }

  // ──────────────── Quality Summary ────────────────

  function buildSummary(bundle) {
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
  const MEDIA_CARD_CONTAINER_SELECTOR = '[class*="MediaCard"], [class*="media-item"], [class*="card"], [class*="Card"], article, li';
  let nextCardIndex = 0;

  function getCardMediaInfo(card) {
    const links = card.matches?.('a[href]') ? [card] : Array.from(card.querySelectorAll('a[href]'));
    const link = links.find(a => MEDIA_LINK_RE.test(a.getAttribute('href') || ''));
    if (!link) return null;

    const href = link.getAttribute('href') || '';
    const tmdbMatch = href.match(MEDIA_LINK_RE);
    if (!tmdbMatch) return null;

    const titleEl = card.querySelector('h2, h3, [class*="title"], [class*="Title"]');
    const imageAlt = card.querySelector('img[alt]')?.getAttribute('alt') || '';
    const title = titleEl?.textContent?.trim() || link.getAttribute('aria-label') || imageAlt || '';

    return {
      link,
      href,
      mediaType: tmdbMatch[1],
      tmdbId: tmdbMatch[2],
      title: title.trim()
    };
  }

  function getMediaCards(root = document) {
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

  // ──────────────── Injection ────────────────

  function injectCardBadges() {
    if (!FEATURE_FLAGS.cardBadges) return;

    // Find media cards on discover/search pages
    const cards = getMediaCards();
    ensureCardIndexes(cards);

    cards.forEach(card => {
      if (card.querySelector('[data-seerr-overlay="true"][class*="card-badge"], [data-seerr-overlay="true"][class*="audience-badge"]')) return;
      if (card.__seerrBadgesResolving) return; // already resolving, skip this pass

      // Try to extract title/TMDB ID from card
      const mediaInfo = getCardMediaInfo(card);
      if (!mediaInfo || !mediaInfo.title) return;

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

      // Resolve ratings asynchronously
      if (mediaInfo.tmdbId) {
        getRatings(mediaInfo.tmdbId, mediaInfo.title, null, mediaInfo.mediaType).then(bundle => {
          // Re-check: a cleanup could have removed any previously-rendered
          // badges since this promise was queued.
          if (card.__seerrBadgesCleared) {
            card.__seerrBadgesResolving = false;
            return;
          }
          if (!bundle || !Model.hasAnyScore(bundle)) {
            card.__seerrBadgesResolving = false;
            return;
          }

          if (bundle.rtCriticsScore !== null && bundle.confidence >= Config.confidenceThreshold) {
            const prefix = bundle.confidence < 1.0 && bundle.confidence >= Config.confidenceThreshold ? '~' : '';
            const badge = document.createElement('span');
            badge.className = 'seerr-card-badge';
            badge.setAttribute('data-seerr-overlay', 'true');
            badge.textContent = `🍅 ${prefix}${bundle.rtCriticsScore}%`;
            card.appendChild(badge);
          }
          if (bundle.rtAudienceScore !== null) {
            const audienceBadge = document.createElement('span');
            audienceBadge.className = 'seerr-card-badge seerr-card-audience-badge';
            audienceBadge.setAttribute('data-seerr-overlay', 'true');
            audienceBadge.textContent = `🍿 ${bundle.rtAudienceScore}%`;
            audienceBadge.style.top = '28px'; // stack below critics badge
            card.appendChild(audienceBadge);
          }
          injectSortFilterControls();
        }).catch(err => log('Card badge ratings failed:', err))
          .finally(() => {
            card.__seerrBadgesResolving = false;
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

    const container = titleBlock.closest('[class*="header"], [class*="Header"], [class*="detail"], [class*="Detail"]');
    if (!container) return;

    if (container.querySelector('[data-seerr-overlay="true"][class*="ratings-row"]')) return;

    // Extract TMDB ID from route
    const tmdbId = route.id;
    const title = document.querySelector('h1')?.textContent?.trim() || '';

    const mediaType = route.type === 'tv-detail' ? 'tv' : 'movie';
    getRatings(tmdbId, title, null, mediaType).then(bundle => {
      if (!bundle || !Model.hasAnyScore(bundle)) return;

      const row = document.createElement('div');
      row.className = 'seerr-ratings-row';
      row.setAttribute('data-seerr-overlay', 'true');

      let hasRowContent = false;

      if (FEATURE_FLAGS.detailRatingsRow) {
        if (bundle.rtCriticsScore !== null) {
          const prefix = bundle.confidence < Config.confidenceThreshold && bundle.confidence > 0 ? '~' : '';
          row.appendChild(makeRatingItem('🍅', `${prefix}${bundle.rtCriticsScore}%`, 'Tomatometer'));
          hasRowContent = true;
        }
        if (bundle.rtAudienceScore !== null) {
          row.appendChild(makeRatingItem('🍿', `${bundle.rtAudienceScore}%`, 'Audience'));
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
    // Overseerr-specific navbar
    if (document.querySelector('[data-testid="navbar"]') && /seerr|overseerr|jellyseerr/i.test(document.body?.textContent || '')) return true;
    // Any Seerr derivative — check for Seerr API patterns in links/scripts
    const links = document.querySelectorAll('a[href*="/api/v1/"], script[src*="/api/"]');
    if (links.length > 0) return true;
    // Check page content for request-related Seerr patterns
    const textSample = (document.title || '') + (document.body?.textContent || '').slice(0, 3000).toLowerCase();
    if (/(seerr|overseerr|jellyseerr|\/api\/v1\/request|\/api\/v1\/search|plex watchlist|request media)/i.test(textSample)) return true;
    // Known Seerr subdomain or path patterns
    if (/request\.|requests|discover\/movie|discover\/tv/i.test(window.location.host + window.location.pathname)) return true;
    return false;
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
    cards.forEach(c => { if (getCardScore(c) !== null) rated++; });
    return { total: cards.length, rated };
  }

  function injectSortFilterControls(retryCount = 0) {
    if (!isSeerrPage()) return;
    if (!FEATURE_FLAGS.sortFilter) return;

    const route = detectRoute();
    if (!isListRoute(route)) return;

    if (document.querySelector('[data-seerr-overlay="true"][class*="sort-filter-bar"]')) return;

    const cards = getMediaCards();
    if (cards.length < 3) return;
    ensureCardIndexes(cards);

    // Coverage check — need at least 30% of cards to have ratings
    const { total, rated } = countCardsWithRatings(cards);
    if (rated / total < 0.3 && retryCount < 3) {
      // Ratings are still loading asynchronously — retry with increasing delays
      setTimeout(() => injectSortFilterControls(retryCount + 1), 1500 + retryCount * 1000);
      return;
    }
    if (rated === 0) return; // truly no ratings available after all retries

    const bar = document.createElement('div');
    bar.className = 'seerr-sort-filter-bar';
    bar.setAttribute('data-seerr-overlay', 'true');

    bar.innerHTML = `
      <span style="font-size:10px;opacity:0.5;margin-right:4px">🔌 Extension</span>
      <label>Sort</label>
      <select class="seerr-sort-select">
        <option value="default">Default</option>
        <option value="rt-critics-desc">🍅 Critics ↓</option>
        <option value="rt-critics-asc">🍅 Critics ↑</option>
        <option value="rt-audience-desc">🍿 Audience ↓</option>
        <option value="rt-audience-asc">🍿 Audience ↑</option>
      </select>
      <label>Critics ≥</label>
      <input type="number" class="seerr-min-critics" min="0" max="100" step="5" value="0" style="width:55px">
      <label>Audience ≥</label>
      <input type="number" class="seerr-min-audience" min="0" max="100" step="5" value="0" style="width:55px">
      <button class="seerr-reset-sort">Reset</button>
      ${FEATURE_FLAGS.bulkActions && apiConfigured ? '<button class="seerr-toggle-select" data-seerr-overlay="true">Select titles</button>' : ''}
    `;

    const firstCard = cards[0];
    const grid = firstCard.parentElement;
    grid.insertBefore(bar, firstCard);

    // Wire toggle button immediately (BUG 5 fix)
    const toggleBtn = bar.querySelector('.seerr-toggle-select');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', toggleBulkMode);
    }

    // ── Sort logic ──
    const sortSelect = bar.querySelector('.seerr-sort-select');
    sortSelect.addEventListener('change', () => {
      const val = sortSelect.value;
      const currentCards = getMediaCards(grid);
      ensureCardIndexes(currentCards);
      const sorted = currentCards.sort((a, b) => {
        let scoreA, scoreB;
        if (val.startsWith('rt-audience')) {
          scoreA = getCardAudienceScore(a);
          scoreB = getCardAudienceScore(b);
        } else {
          scoreA = getCardScore(a);
          scoreB = getCardScore(b);
        }
        // Unrated items go last (push to end with -1)
        const sa = scoreA ?? -Infinity;
        const sb = scoreB ?? -Infinity;
        if (sa === -Infinity && sb === -Infinity) return 0;
        if (sa === -Infinity) return 1;  // a unrated, push to end
        if (sb === -Infinity) return -1; // b unrated, push to end
        if (sa === sb) return (parseInt(a.getAttribute('data-seerr-card-index')) || 0) - (parseInt(b.getAttribute('data-seerr-card-index')) || 0);
        if (val.includes('desc')) return sb - sa;
        if (val.includes('asc')) return sa - sb;
        return 0;
      });
      sorted.forEach(c => grid.appendChild(c));
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
        grid.appendChild(c);
      });
      sortSelect.value = 'default';
      bar.querySelector('.seerr-min-critics').value = '0';
      bar.querySelector('.seerr-min-audience').value = '0';
    });

    // Store original index on each card
    ensureCardIndexes(cards);

    // ── Filter logic ──
    function applyFilters() {
      const minCritics = parseInt(bar.querySelector('.seerr-min-critics').value) || 0;
      const minAudience = parseInt(bar.querySelector('.seerr-min-audience').value) || 0;
      const currentCards = getMediaCards(grid);
      ensureCardIndexes(currentCards);
      currentCards.forEach(c => {
        const cs = getCardScore(c);
        const as = getCardAudienceScore(c);
        const hidesForCritics = minCritics > 0 && (cs === null || cs < minCritics);
        const hidesForAudience = minAudience > 0 && (as === null || as < minAudience);
        c.style.display = (hidesForCritics || hidesForAudience) ? 'none' : '';
      });
    }

    bar.querySelector('.seerr-min-critics').addEventListener('input', applyFilters);
    bar.querySelector('.seerr-min-audience').addEventListener('input', applyFilters);
  }

  function getCardScore(card) {
    const badge = card.querySelector('.seerr-card-badge');
    if (!badge) return null;
    const match = badge.textContent.match(/🍅\s*~?(\d+)%/);
    return match ? parseInt(match[1]) : null;
  }

  function getCardAudienceScore(card) {
    const badge = card.querySelector('.seerr-card-audience-badge');
    if (!badge) return null;
    const match = badge.textContent.match(/🍿\s*~?(\d+)%/);
    return match ? parseInt(match[1]) : null;
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

        const checkbox = document.createElement('div');
        checkbox.className = 'seerr-select-checkbox';
        checkbox.setAttribute('data-seerr-overlay', 'true');
        checkbox.addEventListener('click', (e) => {
          e.stopPropagation();
          if (selectedCards.has(card)) {
            selectedCards.delete(card);
            checkbox.classList.remove('checked');
          } else {
            selectedCards.add(card);
            checkbox.classList.add('checked');
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
      const confidence = score !== null ? 1.0 : 0.0;
      titles.push({
        title: mediaInfo?.title || 'Unknown Title',
        tmdbId: mediaInfo?.tmdbId || null,
        mediaType: mediaInfo?.mediaType || 'movie',
        score,
        confidence
      });
    });
    return titles;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function openBulkConfirmation() {
    if (selectedCards.size === 0) return;

    const titles = getSelectedTitles();
    // A title is only "ready" if it has BOTH a TMDB ID and a passing
    // confidence score — a high score alone is useless without an ID
    // because the API can't resolve the request.
    const readyTitles = titles.filter(t => t.tmdbId && t.confidence >= Config.confidenceThreshold);
    const excludedTitles = titles.filter(t => !t.tmdbId || t.confidence < Config.confidenceThreshold);

    const modal = document.createElement('div');
    modal.className = 'seerr-confirmation-modal';
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
            ${excludedTitles.map(t => `<li class="excluded">• ${escapeHtml(t.title)}${!t.tmdbId ? ' (no TMDB ID)' : ` (~${Math.round(t.confidence * 100)}% conf.)`}</li>`).join('')}
          </ul>
        </details>
      ` : ''}
      <div class="modal-actions">
        <button class="cancel-btn">Cancel</button>
        <button class="confirm-btn">Request ${readyTitles.length} titles</button>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());

    modal.querySelector('.confirm-btn').addEventListener('click', async () => {
      if (!apiConfigured) {
        modal.querySelector('.confirm-btn').textContent = 'API key required — configure in extension settings';
        modal.querySelector('.confirm-btn').style.background = '#ef4444';
        return;
      }
      const btn = modal.querySelector('.confirm-btn');
      btn.disabled = true;
      btn.textContent = 'Requesting...';

      let succeeded = 0;
      let failed = 0;
      const BULK_REQUEST_DELAY_MS = 500;

      for (let i = 0; i < readyTitles.length; i++) {
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

      modal.remove();
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
    clearCache:   () => ratingsCache.clear(),
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

// Seerr Pre-Request Ratings Overlay
// Injects Rotten Tomatoes context on Seerr browse cards and detail pages.
// Prefers Seerr-native ratings data; falls back to confidence-aware resolution.
// The request flow remains visually primary throughout.

(function () {
  if (window.__seerr_overlay_installed) return;

  const Model = window.RatingsModel;
  const Config = window.RatingsConfig;
  if (!Model || !Config || !window.createOverlayCache || !window.createRatingsPresentation || !window.createSeerrSession) return;
  window.__seerr_overlay_installed = true;

  let debugMode = false;
  function log(...args) { if (debugMode) console.log('🍅 [Seerr Overlay]', ...args); }

  const FEATURE_FLAGS = {
    cardBadges: true,
    detailRatingsRow: true,
    preRequestSummary: true,
    sortFilter: true,
    bulkActions: true,
    plexWatchlist: true,
  };

  let apiConfigured = false;
  let plexConfigured = false;
  let configuredServer = null;

  // Check API config — controls whether request features are available.
  // The API key is deliberately never read here: the worker answers whether
  // requests are possible so the secret stays out of this page's heap.
  // The Plex token stays out the same way: only plexConfigured crosses.
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
      if (previousServer !== configuredServer?.href) {
        forgetPersistedRatings();
        lastListItems = [];
      }

      const response = await chrome.runtime.sendMessage({ action: 'getConfigState' }).catch(() => null);
      apiConfigured = response?.success === true && response.data?.apiConfigured === true;
      plexConfigured = response?.success === true && response.data?.plexConfigured === true;
      log('API configured:', apiConfigured, 'Plex configured:', plexConfigured);
    } catch (error) {
      log('Could not load Seerr settings:', error);
    }
  }
  checkApiConfig().then(() => injectOverlay());

  // Update when settings change (e.g., user configures from options page).
  // The URL and feature flags sync; the API keys are device-local.
  chrome.storage.onChanged.addListener((changes, namespace) => {
    // Settings clears the cache by removing the key. Our own flushes always
    // write a value, so only a removal counts as a clear.
    if (namespace === 'local' && (changes.ratingsCacheEpoch ||
        (changes[PERSISTED_RATINGS_KEY] && changes[PERSISTED_RATINGS_KEY].newValue === undefined))) {
      forgetPersistedRatings();
      pageRatingsByTmdbId.clear();
      pageMetadataByTmdbId.clear();
      embeddedRatingsByTmdbId.clear();
      pageRatingsFetches.clear();
      embeddedRatingsIndexed = false;
      // The title index is cleared with everything else: it belongs to the
      // catalogue as it was, and re-resolving it is cheaper than badges.
      lastListItems = [];
      // Clearing the cache is also a request to retry endpoints we had
      // written off, in case the server has gained a ratings backend since.
      resetSeerrRatings();
      cleanupOverlay();
      injectOverlay();
      return;
    }
    const relevant = (namespace === 'sync' && (changes.seerrUrl || changes.overlayFeatures)) ||
      (namespace === 'local' && (changes.seerrApiKey || changes.plexToken));
    if (relevant) checkApiConfig().then(() => { cleanupOverlay(); injectOverlay(); });
  });

  const PERSISTED_RATINGS_KEY = 'overlayRatingsV1';
  const { ratingsCache, loadPersistedRatings, schedulePersistedRatingsFlush,
    flushPersistedRatings, forgetPersistedRatings } = window.createOverlayCache({
      Config, Model, log, getServer: () => configuredServer,
      getListIndex: projectListIndex, restoreListIndex
    });
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
    // A debounced write still waiting would die with this context, taking the
    // latest resolutions with it. Flush now so a reload finds them on disk.
    flushPersistedRatings();
    if (cardObserver) { cardObserver.disconnect(); cardObserver = null; }
    clearTimeout(cardObserverTimer);
  });
  // A hidden tab may never get pagehide before the browser discards it.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPersistedRatings();
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

  const { parsePercentScore, parseTenPointScore, bundleFromRatingObject,
    isBundleComplete, mergeBundles, buildSummary } = window.createRatingsPresentation({ Model, Config });

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

  // Rotten Tomatoes lists most films under their English title, so the
  // original is worth keeping when Seerr shows a localised one.
  // A Seerr detail heading reads "Moana 2 (2024)". Left whole, that title only
  // ever substring-matches Rotten Tomatoes' "Moana 2", and the year it carries
  // goes to waste. Only a parenthesised trailing year counts, so "Blade Runner
  // 2049" and "Apollo 13" keep their numbers.
  function splitDisplayTitle(heading) {
    const text = String(heading ?? '').trim();
    const match = text.match(/^(.*\S)\s*\((\d{4})\)$/);
    if (!match) return { title: text, year: null };
    const year = parseInt(match[2], 10);
    if (year < 1870 || year > new Date().getFullYear() + 10) return { title: text, year: null };
    return { title: match[1].trim(), year };
  }

  function objectOriginalTitle(obj) {
    if (!obj || typeof obj !== 'object') return '';
    return obj.originalTitle || obj.originalName
      || obj.mediaInfo?.originalTitle || obj.mediaInfo?.originalName
      || obj.media?.originalTitle || obj.media?.originalName || '';
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

  const { fetchJsonFromSeerr, loadRatingsAvailability, resetSeerrRatings, fetchSeerrSessionRatings, seerrRatingsRequests } = window.createSeerrSession({
    Config, Model, log, getServer: () => configuredServer, bundleFromRatingObject, mergeBundles, isBundleComplete
  });

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
        const originalTitle = objectOriginalTitle(candidate);
        const year = objectYear(candidate);
        if (title || originalTitle || year) {
          const held = pageMetadataByTmdbId.get(key);
          pageMetadataByTmdbId.set(key, {
            title: title || held?.title || '',
            originalTitle: originalTitle || held?.originalTitle || '',
            year: year || held?.year || null
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

  // What a cold load needs per title to identify cards before Seerr's own
  // lists arrive. Raw items carry far more fields than that; only the
  // identifying ones cross into storage, in a shape the live pipeline reads
  // back directly (poster matching, media info, page metadata).
  function projectListIndex(items) {
    const seen = new Set();
    const projected = [];    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const info = mediaInfoFromListItem(item);
      if (!info || !/^\d+$/.test(String(info.tmdbId))) continue;
      if (info.mediaType !== 'movie' && info.mediaType !== 'tv') continue;
      const key = `${info.mediaType}:${info.tmdbId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const raw = item.media || item.mediaInfo || item.movie || item.tv || item;
      const poster = item.posterPath || item.poster_path || raw.posterPath || raw.poster_path || null;
      projected.push({
        tmdbId: String(info.tmdbId),
        mediaType: info.mediaType,
        title: info.title || '',
        originalTitle: objectOriginalTitle(item) || '',
        year: info.year ?? null,
        posterPath: typeof poster === 'string' && poster.length > 1 ? poster : null,
        ...(typeof raw.releaseDate === 'string' ? { releaseDate: raw.releaseDate } : {}),
        ...(typeof raw.firstAirDate === 'string' ? { firstAirDate: raw.firstAirDate } : {})
      });
    }
    return projected.slice(-(Config.listIndexMaxEntries ?? 2000));
  }

  // The loader calls this with the stored array after the server and epoch
  // checks pass. Entries are revalidated: storage is writable by anything
  // sharing the extension's local area, and a malformed entry must never
  // identify the wrong card.
  function restoreListIndex(stored) {
    if (!Array.isArray(stored)) return;
    const restored = [];
    const seen = new Set();
    for (const entry of stored) {
      if (!entry || typeof entry !== 'object') continue;
      const tmdbId = String(entry.tmdbId ?? '');
      const mediaType = entry.mediaType;
      if (!/^\d+$/.test(tmdbId) || (mediaType !== 'movie' && mediaType !== 'tv')) continue;
      const key = `${mediaType}:${tmdbId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const title = typeof entry.title === 'string' ? entry.title : '';
      const originalTitle = typeof entry.originalTitle === 'string' ? entry.originalTitle : '';
      const year = Number.isInteger(entry.year) ? entry.year : null;
      const posterPath = typeof entry.posterPath === 'string' && entry.posterPath.length > 1 ? entry.posterPath : null;
      restored.push({
        tmdbId, mediaType, title, originalTitle, year, posterPath,
        ...(typeof entry.releaseDate === 'string' ? { releaseDate: entry.releaseDate } : {}),
        ...(typeof entry.firstAirDate === 'string' ? { firstAirDate: entry.firstAirDate } : {})
      });
      if (title || originalTitle || year) {
        // Live observations are fresher than anything stored: fill the gaps
        // without overwriting what the page already said.
        if (!pageMetadataByTmdbId.has(key)) {
          pageMetadataByTmdbId.set(key, { title, originalTitle, year });
        }
      }
    }
    if (lastListItems.length === 0) {
      lastListItems = restored;
      return;
    }
    // Live items may have arrived before the stored read finished; keep both,
    // preferring the live copy where they describe the same title.
    const liveKeys = new Set();
    for (const item of lastListItems) {
      const info = mediaInfoFromListItem(item);
      if (info) liveKeys.add(`${info.mediaType}:${info.tmdbId}`);
    }
    lastListItems = lastListItems.concat(
      restored.filter(item => !liveKeys.has(`${item.mediaType}:${item.tmdbId}`)));
    if (lastListItems.length > Config.overlayCacheMaxEntries) {
      lastListItems = lastListItems.slice(-Config.overlayCacheMaxEntries);
    }
  }

  // Why a given card has no identity yet. Distinguishes "Seerr has not mounted
  // the link" from "nothing we observed matches this poster" from "the poster
  // matches more than one title, so resolving it would be a guess".
  // The identity fields only: getCardMediaInfo also holds the live anchor.
  function plainMediaInfo(info) {
    if (!info) return null;
    const { href, mediaType, tmdbId, title } = info;
    return { href, mediaType, tmdbId, title };
  }

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
          hasMediaLink: Array.from(card.querySelectorAll('a[href]')).some(a => mediaLinkTarget(a.getAttribute('href'))),
          posterMatches: posterMatches.length,
          reason: !posterUrl ? 'no poster image to match on'
            : lastListItems.length === 0 ? 'nothing observed from the page yet'
            : posterMatches.length === 0 ? 'no observed title has this poster'
            : posterMatches.length > 1 ? 'more than one observed title has this poster'
            : 'resolvable; awaiting the next pass'
        };
      });
  }

  // Indexed view of lastListItems for hydrate: a full scan per card per pass
  // starves the main thread on large grids (hundreds of ms each), which is
  // what the browser's kill-or-wait dialog is for. Rebuilt only when the
  // underlying array is replaced, so steady-state passes are lookups.
  let listLookupIndex = null;
  function posterFileName(poster) {
    return String(poster ?? '').split('?')[0].split('/').pop() ?? '';
  }
  function indexedListItems() {
    if (listLookupIndex && listLookupIndex.items === lastListItems) return listLookupIndex;
    const byPosterFile = new Map();
    const byTitle = new Map();
    for (const item of lastListItems) {
      const poster = item && (item.posterPath || item.poster_path);
      if (typeof poster === 'string' && poster.length > 1) {
        const file = posterFileName(poster);
        if (file) {
          if (!byPosterFile.has(file)) byPosterFile.set(file, []);
          byPosterFile.get(file).push(item);
        }
      }
      const info = mediaInfoFromListItem(item);
      const title = info && info.title.trim().toLowerCase();
      if (title) {
        if (!byTitle.has(title)) byTitle.set(title, []);
        byTitle.get(title).push(item);
      }
    }
    listLookupIndex = { items: lastListItems, byPosterFile, byTitle };
    return listLookupIndex;
  }

  function hydrateCardsFromListItems(root = document) {
    if (!lastListItems.length) return;
    const { byPosterFile, byTitle } = indexedListItems();
    const cards = getMediaCards(root);
    cards.forEach(card => {
      if (getCardMediaInfo(card)) return;
      const title = (card.querySelector('h2, h3, [class*="title"], [class*="Title"]')?.textContent
        || card.querySelector('img[alt]')?.getAttribute('alt') || '').trim().toLowerCase();
      const image = card.querySelector('img');
      const posterUrl = (image?.getAttribute('src') || '').split('?')[0];
      // The same title recurs across refetches and overlapping lists. Those
      // duplicates share one identity and must collapse; a poster shared by
      // two genuinely different titles still refuses, as before.
      const seenIdentities = new Set();
      const uniqueMatches = matches => matches.map(mediaInfoFromListItem).filter(info => {
        if (!info) return false;
        const key = `${info.mediaType}:${info.tmdbId}`;
        if (seenIdentities.has(key)) return false;
        seenIdentities.add(key);
        return true;
      });
      // Suffix matching is preserved exactly: the filename buckets candidates
      // and endsWith verifies, so a shared filename across different paths
      // still counts every path that truly matches.
      let matches = [];
      const file = posterFileName(posterUrl);
      if (file) {
        matches = uniqueMatches(
          (byPosterFile.get(file) || []).filter(item => {
            const poster = item.posterPath || item.poster_path;
            return typeof poster === 'string' && poster.length > 1 && posterUrl.endsWith(poster);
          }));
      }
      if (matches.length === 0 && title) {
        matches = uniqueMatches(byTitle.get(title) || []);
      }
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
  // Seerr fires its first lists while this script is still waiting on settings,
  // and those first lists are the most identifying ones the page will see.
  // They wait here instead of being dropped, and replay once the server is
  // known. Bounded: a page that never configures a server drops them instead.
  const earlyApiEvents = [];

  function handleObservedApiResponse(event) {
    // Same window, same origin, and our channel: anything else is not ours.
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.channel !== 'super-seerr:api') return;
    if (!Array.isArray(data.items)) { observedStats.rejected++; return; }
    if (!isSeerrPage()) {
      if (!configuredServer && earlyApiEvents.length < 10) { earlyApiEvents.push(event); return; }
      observedStats.rejected++;
      return;
    }

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
      injectPlexCardButtons();
      injectSortFilterControls();
    }, 200);
  }

  window.addEventListener('message', handleObservedApiResponse);

  // Answer the page-world bridge so diagnostics are reachable from the default
  // DevTools console, not only after switching to the extension's context.
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    if (event.data?.channel !== 'super-seerr:diagnose') return;
    let report;
    try {
      report = window.seerr_debug?.ratings?.diagnose?.() ?? { error: 'diagnostics unavailable' };
    } catch (error) {
      report = { error: String(error && error.message ? error.message : error) };
    }
    // postMessage structure-clones this, and anything holding a DOM node throws
    // DataCloneError — which used to surface as an uncaught error here and leave
    // the caller to time out blaming a missing overlay. The report is built as
    // plain data; this catch keeps a future slip diagnosable rather than silent.
    try {
      window.postMessage({ channel: 'super-seerr:diagnosed', id: event.data.id, report }, window.location.origin);
    } catch (error) {
      window.postMessage({
        channel: 'super-seerr:diagnosed',
        id: event.data.id,
        report: { error: `The report could not be sent: ${error && error.message ? error.message : error}` }
      }, window.location.origin);
    }
  });

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

  // `outcome` distinguishes "we asked and there is nothing" from "we could not
  // ask". Both produce a null bundle, and only the first is worth remembering:
  // MV3 evicts the worker after seconds of idle, so a sendMessage failing
  // mid-burst is ordinary, and caching that as "unrated" would hide a real
  // score for as long as the absence lives.
  async function fetchRottenTomatoesRatings(title, year, mediaType, refresh = false, originalTitle = null, outcome = {}) {
    if (!title) return null;

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'getRottenTomatoesRatings',
        // The worker holds RT for 24 hours, and RT is the score most likely to
        // have moved, so a refresh has to reach past that cache too.
        data: { title, originalTitle, year, mediaType, refresh }
      });
      // The worker answering "no match" is an answer. The worker failing is not.
      if (!response?.success) {
        outcome.conclusive = false;
        return null;
      }
      if (response.diagnostic === 'uncertain') outcome.uncertain = true;
      if (response.diagnostic === 'failed') outcome.conclusive = false;
      if (!response.data) return null;

      return Model.createRatingsBundle({
        rtCriticsScore: response.data.rtCriticsScore ?? null,
        rtAudienceScore: response.data.rtAudienceScore ?? null,
        confidence: response.data.confidence ?? 0,
        source: response.data.source || 'rotten-tomatoes',
        lastUpdated: Date.now()
      });
    } catch (error) {
      log('Rotten Tomatoes lookup failed:', error);
      outcome.conclusive = false;
      return null;
    }
  }

  async function resolveRatings(tmdbId, title, year, mediaType = null, options = {}) {
    // Callers may hand over a display heading with its year still attached.
    const heading = splitDisplayTitle(title);
    title = heading.title || title;
    year = year ?? heading.year;
    log(`Resolving ratings for TMDB ${tmdbId}`);
    // Refreshes must read the sources again, not recycle the page's old scores.
    const native = options.refresh ? null : extractSeerrNativeRatings(tmdbId, mediaType);
    await indexCurrentListRatings();
    const pageMeta = tmdbId !== null && tmdbId !== undefined ? pageMetadataByTmdbId.get(ratingKey(tmdbId, mediaType)) : null;
    const lookupTitle = title || pageMeta?.title || '';
    const lookupYear = year || pageMeta?.year || null;
    const pageBundle = tmdbId !== null && tmdbId !== undefined ? pageRatingsByTmdbId.get(ratingKey(tmdbId, mediaType)) : null;
    let bundle = options.refresh ? null : mergeBundles(native, pageBundle);
    // A refresh asks the configured server first, avoiding external scraping
    // entirely when Seerr can already supply the current ratings.
    if (options.refresh) bundle = await fetchSeerrSessionRatings(tmdbId, mediaType, null, options.outcome ?? {});

    if (!bundle || bundle.rtCriticsScore === null || bundle.rtAudienceScore === null) {
      const rtBundle = await fetchRottenTomatoesRatings(
        lookupTitle, lookupYear, mediaType, options.refresh === true, pageMeta?.originalTitle || null, options.outcome ?? {});
      if (rtBundle && rtBundle.confidence >= Config.confidenceThreshold) {
        bundle = mergeBundles(bundle, rtBundle);
      } else if (rtBundle && options.outcome) {
        options.outcome.uncertain = true;
      }
    }
    // Continue filling partial bundles without overwriting higher-trust data.
    // Passing what is already known lets it skip endpoints that could only
    // return those same fields.
    if (!options.refresh && !isBundleComplete(bundle)) {
      bundle = mergeBundles(bundle, await fetchSeerrSessionRatings(tmdbId, mediaType, bundle, options.outcome ?? {}));
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
    // Refreshing is the user asking us to try again, including endpoints we
    // had given up on.
    resetSeerrRatings();
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

  // ──────────────── Load the rest of the grid ────────────────
  // Sorting can only order what is rendered, so a grid you have scrolled a
  // third of the way through sorts a third of the results. This pulls the rest
  // in and scores it, after which the whole grid sorts and filters as one.
  //
  // Seerr renders more only in response to a real scroll event landing within
  // 200px of the bottom (its useVerticalScroll hook), so loading more means
  // scrolling there and waiting, not calling an endpoint: the cards have to
  // exist in the DOM for sorting to reach them.
  let bulkRun = null;

  function waitForMoreCards(previous, run) {
    return new Promise(resolve => {
      const deadline = Date.now() + Config.bulkLoadWaitMs;
      const poll = () => {
        if (run.cancelled) return resolve(false);
        if (getMediaCards().length > previous) return resolve(true);
        if (Date.now() >= deadline) return resolve(false);
        setTimeout(poll, 150);
      };
      setTimeout(poll, 150);
    });
  }

  async function loadMoreCards(run, onProgress) {
    const startCount = getMediaCards().length;
    // Returning the reader to where they were: this scrolls the page for real.
    const restoreX = window.scrollX, restoreY = window.scrollY;
    let previous = startCount;
    try {
      while (!run.cancelled && getMediaCards().length - startCount < Config.bulkLoadTarget) {
        window.scrollTo(0, document.documentElement.scrollHeight);
        // No new cards means the list has ended; there is nothing more to ask for.
        if (!await waitForMoreCards(previous, run)) break;
        previous = getMediaCards().length;
        onProgress(previous - startCount);
      }
    } finally {
      window.scrollTo(restoreX, restoreY);
    }
    return getMediaCards().length - startCount;
  }

  async function scoreAllCards(run, onProgress) {
    const titles = getMediaCards()
      .filter(card => getCardAnyScore(card) === null)
      .map(card => getCardMediaInfo(card))
      .filter(info => info && info.tmdbId);
    let done = 0;
    for (let index = 0; index < titles.length; index += Config.bulkScoreBatch) {
      if (run.cancelled) break;
      const batch = titles.slice(index, index + Config.bulkScoreBatch);
      await Promise.all(batch.map(info =>
        getRatings(info.tmdbId, info.title, info.year ?? null, info.mediaType).catch(() => null)));
      done += batch.length;
      onProgress(done, titles.length);
      // Paints whatever the batch resolved; cards already carrying a badge are
      // skipped, so calling this per batch stays cheap.
      injectCardBadges();
    }
    return done;
  }

  // A threshold above zero is narrowing the grid, so show which ones are live.
  function markActiveFilters(bar) {
    bar.querySelectorAll('.seerr-filter-field[data-score]').forEach(field => {
      const input = field.querySelector('input[type="number"]');
      field.classList.toggle('is-active', (parseFloat(input?.value) || 0) > 0);
    });
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
      card.querySelectorAll('[data-seerr-overlay="true"][class*="card-badge"], .seerr-rating-details').forEach(badge => badge.remove());
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
    await loadRatingsAvailability();

    const key = ratingsCacheKey(tmdbId, title, year, mediaType);
    const previous = ratingsCache.get(key);
    let cached = options.refresh === true ? null : previous;
    // Missing scores expire sooner than complete results.
    const absenceTtl = cached?.provisional ? Config.inconclusiveRetryMs : Config.unratedRetryMs;
    if (cached && !cached.bundle && Date.now() - (cached.cachedAt ?? 0) >= absenceTtl) {
      ratingsCache.delete(key);
      cached = null;
    }
    if (cached) {
      log(cached.bundle ? `Cache hit for ${key}` : `Known to be unrated: ${key}`);
      // Re-insert to mark it most recently used, so the cap evicts by use
      // rather than by insertion order.
      ratingsCache.delete(key);
      ratingsCache.set(key, cached);
      const freshMs = isBundleComplete(cached.bundle) ? Config.ratingsFreshMs : Config.partialRatingsRetryMs;
      const retryAt = cached.retryAt ?? ((cached.cachedAt ?? 0) + freshMs);
      if (cached.bundle && Date.now() >= retryAt && !cached.refreshing && !ratingsCache.has(`pending:${key}`)) {
        cached.refreshing = true;
        const generation = routeGeneration;
        // Return the current score immediately. Coalescing and the resolver
        // deadline still apply to this background update.
        void getRatings(tmdbId, title, year, mediaType, { refresh: true, background: true })
          .then(() => {
            if (generation === routeGeneration && ratingsCache.has(key)) repaintRatingTitle(tmdbId, mediaType);
          })
          .catch(error => {
            log('Background ratings refresh failed:', error);
            if (generation === routeGeneration && ratingsCache.has(key)) repaintRatingTitle(tmdbId, mediaType);
          })
          .finally(() => { cached.refreshing = false; });
      }
      return cached.bundle;
    }

    // Coalesce concurrent requests
    const pendingKey = `pending:${key}`;
    if (ratingsCache.has(pendingKey)) {
      log(`Coalescing request for ${key}`);
      return ratingsCache.get(pendingKey);
    }

    // Whether a null result means "nothing knows this title" or "we could not
    // find out". Only the first is worth remembering.
    const outcome = {};
    const promise = resolveRatings(tmdbId, title, year, mediaType, { ...options, outcome });
    ratingsCache.set(pendingKey, promise);
    // A hung channel must not pin the coalesced promise forever: after the
    // deadline the title goes provisional (retried in minutes, never stored)
    // and the late answer finds its slot already cleared and drops itself.
    let resolveTimer = null;
    const deadline = new Promise(resolve => {
      resolveTimer = setTimeout(() => { outcome.conclusive = false; resolve(null); }, Config.resolveTimeoutMs);
    });

    try {
      const bundle = await Promise.race([promise, deadline]);
      // Storing the absence is the point: without it every visit asks again.
      let storable = bundle && Model.hasAnyScore(bundle) ? bundle : null;
      // An unavailable source is not evidence that a previously known score
      // disappeared. Keep those values visible and retry the missing source.
      if (options.refresh && outcome.conclusive === false && previous?.bundle) {
        storable = mergeBundles(storable, previous.bundle);
      }
      // A lookup that could not complete tells us nothing about the title, so
      // it is held briefly and in memory only: long enough that the page stops
      // re-asking on every pass, short enough to cost nothing once the server
      // or the worker is back.
      const provisional = !storable && outcome.conclusive === false;
      if (ratingsCache.get(pendingKey) === promise) {
        while (resolvedCacheSize() >= Config.overlayCacheMaxEntries) {
          const lru = [...ratingsCache.keys()].find(existingKey => !existingKey.startsWith('pending:'));
          if (lru === undefined) break;
          ratingsCache.delete(lru);
        }
        const checkedAt = Date.now();
        const status = outcome.conclusive === false ? 'failed' : outcome.uncertain ? 'uncertain'
          : !storable ? 'unrated' : isBundleComplete(storable) ? 'rated' : 'partial';
        const retryMs = outcome.conclusive === false ? Config.inconclusiveRetryMs
          : status === 'unrated' ? Config.unratedRetryMs
          : status === 'rated' ? Config.ratingsFreshMs : Config.partialRatingsRetryMs;
        ratingsCache.set(key, { bundle: storable, cachedAt: checkedAt, retryAt: checkedAt + retryMs,
          diagnostics: { status, checkedAt, source: storable?.source || 'No source returned a score' },
          ...(provisional ? { provisional: true } : {}) });
        if (!provisional) schedulePersistedRatingsFlush();
      }
      return storable || bundle;
    } catch (error) {
      if (options.refresh && previous?.bundle && ratingsCache.get(pendingKey) === promise) {
        ratingsCache.set(key, { ...previous, refreshing: false, retryAt: Date.now() + Config.inconclusiveRetryMs,
          diagnostics: { status: 'failed', checkedAt: Date.now(), source: previous.bundle.source } });
      }
      throw error;
    } finally {
      if (resolveTimer !== null) clearTimeout(resolveTimer);
      if (ratingsCache.get(pendingKey) === promise) ratingsCache.delete(pendingKey);
    }
  }

  function appendRatingDetails(container, info) {
    if (container.querySelector('.seerr-rating-details')) return;
    const entry = ratingsCache.get(ratingsCacheKey(info.tmdbId, info.title, info.year, info.mediaType));
    const diagnostics = entry?.diagnostics;
    const status = diagnostics?.status || (entry?.bundle ? 'partial' : 'unrated');
    const messages = {
      rated: 'All score sources returned ratings.',
      partial: 'Some sources have no score for this title yet.',
      unrated: 'No source returned a rating for this title.',
      failed: 'A lookup failed. Any known scores are kept while we retry.',
      uncertain: 'A Rotten Tomatoes match was uncertain, so its score is hidden.'
    };
    const details = document.createElement('details');
    details.className = 'seerr-rating-details';
    details.setAttribute('data-seerr-overlay', 'true');
    const summary = document.createElement('summary');
    summary.textContent = 'Score details';
    summary.setAttribute('aria-label', `Score details for ${info.title || 'this title'}`);
    const text = document.createElement('p');
    const checkedAt = diagnostics?.checkedAt ?? entry?.cachedAt;
    text.textContent = `${messages[status] || messages.partial} Source: ${diagnostics?.source || entry?.bundle?.source || 'Not recorded'}. Last checked: ${checkedAt ? new Date(checkedAt).toLocaleString() : 'Unknown'}.`;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Retry scores';
    details.addEventListener('click', event => event.stopPropagation());
    retry.addEventListener('click', async event => {
      event.preventDefault();
      if (retry.disabled) return;
      retry.disabled = true;
      retry.textContent = 'Checking…';
      const generation = routeGeneration;
      try {
        await getRatings(info.tmdbId, info.title, info.year, info.mediaType, { refresh: true });
        if (generation === routeGeneration && container.isConnected) repaintRatingTitle(info.tmdbId, info.mediaType);
      } catch (_) {
        text.textContent = 'The lookup failed. Please try again when the service is available.';
      } finally {
        retry.disabled = false;
        retry.textContent = 'Retry scores';
      }
    });
    details.append(summary, text, retry);
    container.appendChild(details);
  }

  function repaintRatingTitle(tmdbId, mediaType) {
    for (const card of getMediaCards()) {
      const info = getCardMediaInfo(card);
      if (!info || String(info.tmdbId) !== String(tmdbId) || info.mediaType !== mediaType) continue;
      card.querySelectorAll('.seerr-card-badge, .seerr-rating-details').forEach(element => element.remove());
      delete card.__seerrRatings;
      card.__seerrBadgesResolving = false;
      card.__seerrBadgesCleared = false;
    }
    const route = detectRoute();
    if (String(route?.id) === String(tmdbId) && route?.type === `${mediaType}-detail`) {
      document.querySelectorAll('.seerr-ratings-row, .seerr-quality-summary, .seerr-rating-details').forEach(element => element.remove());
      injectDetailRatings();
    }
    injectCardBadges();
  }

  function resolvedCacheSize() {
    let count = 0;
    for (const key of ratingsCache.keys()) if (!key.startsWith('pending:')) count++;
    return count;
  }

  // ──────────────── Quality Summary ────────────────



  // Seerr's own routes are /movie/:id and /tv/:id, but that path shape is not
  // unique to this server. A detail page's external-links row points at
  // themoviedb.org/movie/1241982, and matching the raw href read that logo as
  // one of our cards and stamped a rating badge on it. Resolve the href and
  // require the same origin, so only links back into this Seerr count.
  function mediaLinkTarget(href) {
    if (!href) return null;
    let pathname;
    try {
      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) return null;
      pathname = url.pathname;
    } catch {
      return null;
    }
    const match = pathname.match(/^\/(movie|tv)\/(\d+)/);
    return match ? { mediaType: match[1], tmdbId: match[2] } : null;
  }
  const MEDIA_CARD_CONTAINER_SELECTOR = '[data-testid="title-card"], [class*="MediaCard"], [class*="media-item"], article, li, [class*="card"], [class*="Card"]';
  let nextCardIndex = 0;
  let lastListItems = [];

  function getCardMediaInfo(card) {
    if (card.__seerrMediaInfo) return card.__seerrMediaInfo;

    const links = card.matches?.('a[href]') ? [card] : Array.from(card.querySelectorAll('a[href]'));
    const link = links.find(a => mediaLinkTarget(a.getAttribute('href')));
    if (!link) return card.__seerrListMediaInfo || null;

    const href = link.getAttribute('href') || '';
    const target = mediaLinkTarget(href);
    if (!target) return null;

    const titleEl = card.querySelector('h2, h3, [class*="title"], [class*="Title"]');
    const imageAlt = card.querySelector('img[alt]')?.getAttribute('alt') || '';
    const title = titleEl?.textContent?.trim() || link.getAttribute('aria-label') || imageAlt || '';

    card.__seerrMediaInfo = {
      link,
      href,
      mediaType: target.mediaType,
      tmdbId: target.tmdbId,
      title: title.trim()
    };
    return card.__seerrMediaInfo;
  }

  function getMediaCards(root = document) {
    const titleCards = Array.from(root.querySelectorAll('[data-testid="title-card"]'))
      .filter(card => !card.closest('[data-seerr-overlay="true"]'));
    if (titleCards.length > 0) return titleCards;

    const links = Array.from(root.querySelectorAll('a[href]'))
      .filter(link => mediaLinkTarget(link.getAttribute('href')))
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
    // Delayed lazy-card retries may outlive the route that scheduled them.
    if (!isSeerrPage() || !isListRoute(detectRoute())) return;
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
      if (card.__seerrRatings || card.querySelector('.seerr-rating-details')) return;
      if (card.__seerrBadgesResolving) return; // already resolving, skip this pass

      // Try to extract title/TMDB ID from card
      const mediaInfo = getCardMediaInfo(card);
      if (!mediaInfo) return;

      // Ensure card has position relative for absolute positioning
      const computed = window.getComputedStyle(card);
      if (computed.position === 'static') {
        card.style.position = 'relative';
      }
      // Lets the stylesheet step the scores aside while Seerr's own controls
      // are showing. React owns className here, so losing it on a re-render
      // only costs the hover behaviour, never the badges themselves.
      card.classList.add('seerr-scored-card');

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
          if (FEATURE_FLAGS.cardBadges) appendRatingDetails(card, mediaInfo);
          if (!bundle || !Model.hasAnyScore(bundle)) {
            card.__seerrBadgesResolving = false;
            return;
          }

          if (FEATURE_FLAGS.cardBadges) {
            // Anchored to the bottom of the card, the second badge sits above
            // the first, so the offset belongs to whichever is meant to be on
            // top: critics, or TMDB when there is no critics score.
            let upperBadge = null;
            let audienceBadge = null;
            if (bundle.rtCriticsScore !== null && bundle.confidence >= Config.confidenceThreshold) {
              const prefix = bundle.confidence < 1.0 && bundle.confidence >= Config.confidenceThreshold ? '~' : '';
              const badge = document.createElement('span');
              badge.className = 'seerr-card-badge';
              badge.setAttribute('data-seerr-overlay', 'true');
              badge.textContent = `🍅 ${prefix}${bundle.rtCriticsScore}%`;
              card.appendChild(badge);
              upperBadge = badge;
            }
            if (bundle.rtAudienceScore !== null && bundle.confidence >= Config.confidenceThreshold) {
              audienceBadge = document.createElement('span');
              audienceBadge.className = 'seerr-card-badge seerr-card-audience-badge';
              audienceBadge.setAttribute('data-seerr-overlay', 'true');
              audienceBadge.textContent = `🍿 ${bundle.confidence < 1 ? '~' : ''}${bundle.rtAudienceScore}%`;
              card.appendChild(audienceBadge);
            }
            if ((bundle.rtCriticsScore === null || bundle.confidence < Config.confidenceThreshold) && bundle.tmdbRating !== null) {
              const tmdbBadge = document.createElement('span');
              tmdbBadge.className = 'seerr-card-badge seerr-card-tmdb-badge';
              tmdbBadge.setAttribute('data-seerr-overlay', 'true');
              tmdbBadge.textContent = `🎬 ${bundle.tmdbRating}/10`;
              card.appendChild(tmdbBadge);
              upperBadge = upperBadge ?? tmdbBadge;
            }
            // Only a pair needs separating, and only the upper one moves.
            if (audienceBadge && upperBadge) upperBadge.classList.add('seerr-card-badge-upper');
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

    if (container.querySelector('.seerr-ratings-row, .seerr-rating-details')) return;

    // Extract TMDB ID from route
    const tmdbId = route.id;
    // The heading carries its year, as in "Moana 2 (2024)". resolveRatings
    // splits that out for every caller, so it is passed through whole.
    const title = document.querySelector('h1')?.textContent?.trim() || '';

    const mediaType = route.type === 'tv-detail' ? 'tv' : 'movie';
    const generation = routeGeneration;
    getRatings(tmdbId, title, null, mediaType).then(bundle => {
      if (generation !== routeGeneration || !container.isConnected) return;
      const currentRoute = detectRoute();
      if (currentRoute?.type !== route.type || currentRoute.id !== tmdbId) return;
      if (container.querySelector('.seerr-ratings-row, .seerr-quality-summary, .seerr-rating-details')) return;
      appendRatingDetails(container, { tmdbId, title, year: null, mediaType });
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

  // True Plex Watchlist, not Seerr's own list: available titles can be saved
  // directly to plex.tv from the Seerr detail page, without opening Plex.
  function injectPlexWatchlistButton() {
    if (!FEATURE_FLAGS.plexWatchlist || !plexConfigured) return;
    const route = detectRoute();
    if (!route || (route.type !== 'movie-detail' && route.type !== 'tv-detail')) return;
    const titleBlock = document.querySelector('[class*="title"], [class*="Title"], h1');
    if (!titleBlock) return;
    const container = titleBlock.closest('[class*="header"], [class*="Header"], [class*="detail"], [class*="Detail"], [class*="media-page"], [data-testid]')
      || titleBlock.parentElement;
    if (!container || container.querySelector('.seerr-plex-watchlist-button')) return;

    const tmdbId = route.id;
    const title = document.querySelector('h1')?.textContent?.trim() || '';
    const mediaType = route.type === 'tv-detail' ? 'tv' : 'movie';
    if (!tmdbId) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'seerr-plex-watchlist-button';
    button.setAttribute('data-seerr-overlay', 'true');
    button.textContent = '＋ Add to Plex Watchlist';
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      button.disabled = true;
      button.textContent = 'Adding to Plex…';
      try {
        const response = await chrome.runtime.sendMessage({
          action: 'plexAddToWatchlist',
          data: { tmdbId: Number(tmdbId), title, mediaType }
        });
        if (response && response.success) {
          button.textContent = response.data && response.data.already ? '✓ On Plex Watchlist' : '✓ Added to Plex Watchlist';
        } else {
          throw new Error((response && response.error) || 'Plex Watchlist failed');
        }
      } catch (error) {
        button.disabled = false;
        button.textContent = '＋ Add to Plex Watchlist';
        const note = document.createElement('div');
        note.className = 'seerr-quality-summary';
        note.setAttribute('data-seerr-overlay', 'true');
        note.textContent = `Plex Watchlist failed: ${error.message}`;
        container.appendChild(note);
        setTimeout(() => note.remove(), 5000);
      }
    });
    container.appendChild(button);

    // Already there renders as state from the start. A click in flight wins:
    // it disables the button first, so this late answer stands down.
    chrome.runtime.sendMessage({
      action: 'plexWatchlistState',
      data: { tmdbId: Number(tmdbId), title, mediaType }
    }).then(response => {
      if (!button.isConnected || button.disabled) return;
      if (response && response.success && response.data && response.data.onWatchlist) {
        button.disabled = true;
        button.textContent = '✓ On Plex Watchlist';
      }
    }).catch(() => {});
  }

  // Toasts share one corner column so a burst (bulk results, rapid Plex
  // adds) stays readable instead of piling every note on the same spot.
  // Everything here is textContent: titles reaching this point are Seerr's
  // own strings and must never become markup.
  function notifyResult(title, message, kind) {
    let stack = document.querySelector('.seerr-notification-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'seerr-notification-stack';
      stack.setAttribute('data-seerr-overlay', 'true');
      document.body.appendChild(stack);
    }
    const note = document.createElement('div');
    note.className = `seerr-notification ${kind}`;
    const heading = document.createElement('div');
    heading.className = 'seerr-notification-title';
    heading.textContent = title;
    const body = document.createElement('div');
    body.className = 'seerr-notification-message';
    body.textContent = message;
    note.append(heading, body);
    while (stack.children.length >= 4) stack.firstChild.remove();
    stack.appendChild(note);
    setTimeout(() => note.remove(), 5000);
  }

  // Per-card Plex action for grids (discover, search, watchlist, …): available
  // titles are exactly what belongs on a Plex Watchlist, and grids are where
  // browsing happens. One tiny button per card; bulk selection stays
  // request-oriented, so while it owns the top-left corner these stand down.
  function injectPlexCardButtons() {
    if (!FEATURE_FLAGS.plexWatchlist || !plexConfigured) return;
    if (!isSeerrPage() || !isListRoute(detectRoute())) return;
    if (bulkMode) return;
    for (const card of getMediaCards()) {
      const hasButton = Array.from(card.children)
        .some(child => child.classList && child.classList.contains('seerr-plex-card-button'));
      if (hasButton) continue;
      const info = getCardMediaInfo(card);
      const tmdbId = Number(info && info.tmdbId);
      if (!Number.isInteger(tmdbId) || tmdbId <= 0) continue;
      if (!info.mediaType || (info.mediaType !== 'movie' && info.mediaType !== 'tv')) continue;
      // Seerr withholds a card's title until it is hovered. The page-world
      // observer already indexes the titles Seerr fetched for itself, so fill
      // the gaps from there; the worker falls back to a Seerr lookup.
      let cardTitle = info.title || '';
      let cardYear = null;
      if (!cardTitle) {
        const meta = pageMetadataByTmdbId.get(ratingKey(info.tmdbId, info.mediaType));
        if (meta && meta.title) cardTitle = meta.title;
        if (meta && meta.year) cardYear = meta.year;
      }
      const computed = window.getComputedStyle(card);
      if (computed.position === 'static') card.style.position = 'relative';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'seerr-plex-card-button';
      button.setAttribute('data-seerr-overlay', 'true');
      button.setAttribute('aria-label', `Add ${cardTitle || 'this title'} to Plex Watchlist`);
      button.title = 'Add to Plex Watchlist';
      button.textContent = '＋';
      button.addEventListener('click', async event => {
        // The card itself navigates to the detail page; the button must not.
        event.stopPropagation();
        event.preventDefault();
        if (button.disabled) return;
        button.disabled = true;
        button.textContent = '…';
        try {
          const response = await chrome.runtime.sendMessage({
            action: 'plexAddToWatchlist',
            data: { tmdbId, title: cardTitle, year: cardYear, mediaType: info.mediaType }
          });
          if (!response || !response.success) {
            throw new Error((response && response.error) || 'Plex Watchlist failed');
          }
          button.textContent = '✓';
          button.classList.add('is-added');
          button.title = response.data && response.data.already ? 'Already on Plex Watchlist' : 'Added to Plex Watchlist';
          notifyResult(
            response.data && response.data.already ? 'Already on Plex Watchlist' : 'Added to Plex Watchlist',
            `"${cardTitle || response.data.title || 'Title'}" ${response.data && response.data.already ? 'is already' : 'has been added to'} your Plex Watchlist`,
            'success');
        } catch (error) {
          button.disabled = false;
          button.textContent = '＋';
          notifyResult('Plex Watchlist Failed', error.message || 'Failed to add to Plex Watchlist', 'error');
        }
      });
      card.appendChild(button);
    }
  }

  function removePlexCardButtons() {
    document.querySelectorAll('.seerr-plex-card-button').forEach(el => el.remove());
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

      // Lists Seerr spoke before the server was known replay here, after any
      // cleanup, so a settings save cannot wipe them before their first use.
      // Off-server events were never stashed, so everything here belongs here.
      if (earlyApiEvents.length > 0) {
        const queued = earlyApiEvents.splice(0, earlyApiEvents.length);
        for (const queuedEvent of queued) handleObservedApiResponse(queuedEvent);
      }

      if (isListRoute(route)) {
        // The stored title index identifies cards before Seerr's own lists
        // arrive; wait for that read so the first pass already finds them.
        loadPersistedRatings().catch(() => {}).finally(() => {
          if (!isSeerrPage() || !isListRoute(detectRoute())) return;
          hydrateCardsFromListItems();
          injectCardBadges();
          injectPlexCardButtons();
          injectSortFilterControls();
          setupCardObserver();
        });
        setTimeout(() => injectCardBadges(), 2000); // retry for lazy-loaded cards
        setTimeout(() => injectPlexCardButtons(), 2000);
      } else if (route.type === 'movie-detail' || route.type === 'tv-detail') {
        injectDetailRatings();
        injectPlexWatchlistButton();
        setTimeout(() => injectPlexWatchlistButton(), 2000); // detail header renders late
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
        injectPlexCardButtons();
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
      <span class="seerr-cache-age" title="Older scores refresh automatically; refresh now to check the titles on this page"></span>
      <span class="seerr-filter-field"><label for="seerr-sort-order">Sort titles</label>
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
      </select></span>
      <span class="seerr-filter-field" data-score="critics"><label>Critics ≥</label>
        <input type="number" class="seerr-min-critics" min="0" max="100" step="5" value="0"></span>
      <span class="seerr-filter-field" data-score="audience"><label>Audience ≥</label>
        <input type="number" class="seerr-min-audience" min="0" max="100" step="5" value="0"></span>
      <span class="seerr-filter-field" data-score="tmdb"><label>TMDB ≥</label>
        <input type="number" class="seerr-min-tmdb" min="0" max="10" step="0.5" value="0"></span>
      <span class="seerr-filter-field" data-score="imdb"><label>IMDb ≥</label>
        <input type="number" class="seerr-min-imdb" min="0" max="10" step="0.5" value="0"></span>
      <button class="seerr-reset-sort">Reset</button>
      <button class="seerr-refresh-scores" title="Refetch scores for the titles loaded on this page">Refresh scores</button>
      <button class="seerr-load-all" title="Load up to ${Config.bulkLoadTarget} more titles and score them, so sorting covers the whole grid. Click again to stop.">Load ${Config.bulkLoadTarget} more</button>
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

    window.installFilterPresets({
      bar,
      readCurrent: () => ({ sort: currentSort, filters: { ...currentFilters } }),
      apply: preset => {
        currentSort = preset.sort;
        sortSelect.value = currentSort;
        Object.assign(currentFilters, preset.filters);
        for (const [key, field] of Object.entries({ minCritics: 'critics', minAudience: 'audience', minTmdb: 'tmdb', minImdb: 'imdb' })) {
          bar.querySelector(`.seerr-min-${field}`).value = String(currentFilters[key]);
        }
        applyScoreFilters(grid);
        applyScoreSort(grid);
        markActiveFilters(bar);
        updateCoverage();
      }
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
      markActiveFilters(bar);
      updateCoverage();
    });

    // Store original index on each card
    ensureCardIndexes(cards);

    // ── Refresh ──
    bar.querySelector('.seerr-load-all').addEventListener('click', async event => {
      const button = event.currentTarget;
      // A run takes minutes, so the same button stops it rather than hiding the
      // only way out behind a second control.
      if (bulkRun) {
        bulkRun.cancelled = true;
        button.textContent = 'Stopping...';
        return;
      }
      const run = bulkRun = { cancelled: false };
      const label = button.textContent;
      try {
        await loadMoreCards(run, added => { button.textContent = `Loaded ${added}...`; });
        await scoreAllCards(run, (done, total) => { button.textContent = `Scored ${done}/${total}...`; });
      } catch (error) {
        log('Loading the rest of the grid failed:', error);
      } finally {
        bulkRun = null;
        button.textContent = label;
        injectCardBadges();
        updateCoverage();
        applyScoreFilters(grid);
      }
    });

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
      markActiveFilters(bar);
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
      // The selection checkboxes own the top-left corner while active.
      removePlexCardButtons();
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
      injectPlexCardButtons();

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
        <button class="confirm-btn"${readyTitles.length === 0 ? ' disabled' : ''}>Request ${readyTitles.length} titles</button>
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

      notifyResult('Bulk Request Complete',
        `${succeeded} succeeded${failed > 0 ? `, ${failed} failed` : ''}`, 'success');

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
          stashed: earlyApiEvents.length,
          lastAt: observedStats.lastAt,
          byPath: Object.fromEntries(observedStats.byUrl)
        },
        seerrRatings: {
          requestsMade: { ...seerrRatingsRequests }
        },
        listItems: lastListItems.length,
        cachedTitles: resolvedCacheSize(),
        unresolvedCards: explainUnresolvedCards(),
        sampleCards: cards.slice(0, 5).map(card => ({
          // getCardMediaInfo carries the anchor element it matched on, and this
          // report crosses a postMessage, where a DOM node cannot be cloned.
          media: plainMediaInfo(getCardMediaInfo(card)),
          critics: getCardScore(card),
          audience: getCardAudienceScore(card),
          tmdb: getCardTmdbScore(card),
          imdb: getCardImdbScore(card)
        }))
      };
    },
    clearCache:   () => chrome.runtime.sendMessage({ action: 'clearRatingsCache' }),
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

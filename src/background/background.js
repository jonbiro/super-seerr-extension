// Background service worker for Seerr integration
import '../shared/RatingsConfig.js';
const RatingsConfig = globalThis.RatingsConfig;

// Persisted RT cache lives under one storage.local key so a whole grid of
// lookups collapses into a single debounced write.
const RT_CACHE_STORAGE_KEY = 'rtCacheV1';
const RT_CACHE_FLUSH_DELAY_MS = 500;

// The Seerr server is self-hosted, so its origin is only known at runtime and
// cannot be a static content_scripts match. The overlay is registered against
// the saved origin instead, once the user grants that optional host permission.
const OVERLAY_SCRIPT_ID = 'seerr-overlay';
const OVERLAY_SCRIPT_FILES = {
  js: ['src/shared/RatingsModel.js', 'src/shared/RatingsConfig.js', 'src/content/seerr-integration.js'],
  css: ['src/content/seerr-overlay.css']
};

// Seerr unmounts a card's link and title until it is hovered, so an un-hovered
// card cannot be identified from the DOM. This runs in the page's own world at
// document_start to observe the API responses the page already receives.
// Seerr's MediaServerType. Anything else, including NOT_CONFIGURED, gets
// neutral wording rather than a guess at the product name.
const MEDIA_SERVER_NAMES = { 1: 'Plex', 2: 'Jellyfin', 3: 'Emby' };

const OBSERVER_SCRIPT_ID = 'seerr-api-observer';
const OBSERVER_SCRIPT_FILES = { js: ['src/content/seerr-api-observer.js'] };

// An origin match pattern for the saved server, or null when it is unusable.
function overlayOriginPattern(seerrUrl) {
  if (!seerrUrl) return null;
  try {
    const url = new URL(seerrUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    // Match patterns cannot carry a port, and url.origin includes one. A
    // host without a port matches every port, which is what a self-hosted
    // Seerr on :5055 needs.
    return `${url.protocol}//${url.hostname}/*`;
  } catch (_) {
    return null;
  }
}

class SeerrAPI {
  constructor() {
    this.baseUrl = null;
    this.apiKey = null;
    this.debugLogging = false;
    this.mediaServerName = null;
    this.rtCache = new Map();
    this.rtPending = new Map();
    this.rtCacheReady = null;
    this.rtCacheFlushTimer = null;
    this.rtCacheFlushing = null;
  }

  // Verbose tracing is opt-in; errors always surface.
  log(...args) { if (this.debugLogging) console.log(...args); }
  warn(...args) { if (this.debugLogging) console.warn(...args); }

  async migrateStorage() {
    try {
      const old = await chrome.storage.sync.get(['jellyseerrUrl', 'jellyseerrApiKey', 'seerrUrl', 'seerrApiKey']);
      const updates = {};
      const removals = [];

      if (old.jellyseerrUrl) {
        if (old.seerrUrl === undefined) updates.seerrUrl = old.jellyseerrUrl;
        removals.push('jellyseerrUrl');
      }
      if (old.jellyseerrApiKey) {
        if (old.seerrApiKey === undefined) updates.seerrApiKey = old.jellyseerrApiKey;
        removals.push('jellyseerrApiKey');
      }

      if (removals.length > 0) {
        await chrome.storage.sync.set(updates);
        await chrome.storage.sync.remove(removals);
        this.log('✅ [Seerr] Storage migration complete');
      }

      await this.migrateApiKeyToLocal(updates.seerrApiKey ?? old.seerrApiKey);
    } catch (error) {
      console.error('❌ [Seerr] Storage migration failed, continuing:', error);
    }
  }

  // The API key is a secret, so it belongs in device-local storage rather than
  // replicated through the browser account. Copy before removing so an
  // interrupted migration degrades to a duplicate, never to a lost key.
  async migrateApiKeyToLocal(syncedApiKey) {
    if (syncedApiKey === undefined) return;
    const local = await chrome.storage.local.get(['seerrApiKey']);
    if (local.seerrApiKey === undefined) await chrome.storage.local.set({ seerrApiKey: syncedApiKey });
    await chrome.storage.sync.remove(['seerrApiKey']);
    this.log('✅ [Seerr] API key moved to device-local storage');
  }

  async loadSettings() {
    try {
      const [synced, local] = await Promise.all([
        chrome.storage.sync.get(['seerrUrl']),
        chrome.storage.local.get(['seerrApiKey', 'debugLogging'])
      ]);
      this.baseUrl = synced.seerrUrl;
      this.apiKey = local.seerrApiKey;
      this.debugLogging = local.debugLogging === true;
      this.updateIconBadge();
      await this.loadMediaServerName();
    } catch (error) {
      console.error('Error loading Seerr settings:', error);
    }
  }

  updateIconBadge() {
    if (this.baseUrl && this.apiKey) {
      chrome.action.setBadgeText({ text: 'ON' });
      chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
    } else if (this.baseUrl) {
      // URL set but no API key — ratings-only mode
      chrome.action.setBadgeText({ text: 'RT' });
      chrome.action.setBadgeBackgroundColor({ color: '#8b5cf6' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  }

  // Keep the registered overlay in step with the saved server and the granted
  // permission. Safe to call repeatedly; it converges rather than toggling.
  async syncOverlayRegistration() {
    // settingsReady gates every message, so this must never reject.
    if (!chrome.scripting?.registerContentScripts || !chrome.permissions?.contains) return false;
    const pattern = overlayOriginPattern(this.baseUrl);
    let registered = [];
    try {
      registered = await chrome.scripting.getRegisteredContentScripts({ ids: [OVERLAY_SCRIPT_ID, OBSERVER_SCRIPT_ID] });
    } catch (_) {
      registered = [];
    }

    const granted = pattern && await chrome.permissions.contains({ origins: [pattern] }).catch(() => false);
    try {
      if (!granted) {
        if (registered.length > 0) await chrome.scripting.unregisterContentScripts({ ids: registered.map(entry => entry.id) });
        this.log('🔌 [Background] Overlay not registered; no permission for', pattern);
        return false;
      }
      const scripts = [
        { id: OVERLAY_SCRIPT_ID, matches: [pattern], runAt: 'document_idle', ...OVERLAY_SCRIPT_FILES },
        // MAIN world so it can see the page's own fetch, and document_start so
        // it is in place before Seerr issues its first request.
        { id: OBSERVER_SCRIPT_ID, matches: [pattern], runAt: 'document_start', world: 'MAIN', ...OBSERVER_SCRIPT_FILES }
      ];
      const known = new Set(registered.map(entry => entry.id));
      const updates = scripts.filter(script => known.has(script.id));
      const additions = scripts.filter(script => !known.has(script.id));
      if (updates.length > 0) await chrome.scripting.updateContentScripts(updates);
      if (additions.length > 0) await chrome.scripting.registerContentScripts(additions);
      this.log('✅ [Background] Overlay registered for', pattern);
      return true;
    } catch (error) {
      console.error('Could not update the Seerr overlay registration:', error);
      return false;
    }
  }

  // Which media server Seerr is configured against, so the flyout can name it.
  // /settings/public needs no API key, so this also works in ratings-only mode.
  async loadMediaServerName() {
    this.mediaServerName = null;
    if (!this.baseUrl) return;
    try {
      const url = `${this.baseUrl.replace(/\/$/, '')}/api/v1/settings/public`;
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(RatingsConfig.requestTimeoutMs),
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) return;
      const settings = await response.json();
      this.mediaServerName = MEDIA_SERVER_NAMES[settings?.mediaServerType] ?? null;
      this.log('📺 [Background] Media server:', this.mediaServerName ?? 'not identified');
    } catch (error) {
      // Naming is a nicety; neutral wording is always correct.
      this.log('📺 [Background] Could not identify the media server:', error);
    }
  }

  availableMessage() {
    return this.mediaServerName ? `Available on ${this.mediaServerName}` : 'Available to watch';
  }

  watchButtonText() {
    return this.mediaServerName ? `Watch on ${this.mediaServerName}` : 'Watch';
  }

  async handleMessage(request, sender, sendResponse) {
    try {
      switch (request.action) {
        case 'requestMedia': {
          const result = await this.requestMedia(request.data);
          sendResponse({ success: true, data: result });
          break;
        }

        case 'testConnection': {
          const connectionClient = request.data ? new SeerrAPI() : this;
          if (request.data) {
            const url = new URL(request.data.seerrUrl);
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
              throw new Error('Use a server URL without credentials, query parameters, or fragments');
            }
            connectionClient.baseUrl = url.href;
            connectionClient.apiKey = request.data.seerrApiKey;
          }
          const connectionResult = await connectionClient.testConnection();
          sendResponse({ success: true, data: connectionResult });
          break;
        }

        case 'searchMedia': {
          const searchResult = await this.searchMedia(request.query, request.mediaType);
          sendResponse({ success: true, data: searchResult });
          break;
        }

        case 'debugSearch': {
          const debugResult = await this.debugSearch(request.title, request.mediaType);
          sendResponse({ success: true, data: debugResult });
          break;
        }

        case 'ping':
          sendResponse({ success: true, data: 'pong' });
          break;

        case 'debugAPI': {
          const apiDebugResult = await this.debugAPI(request.tmdbId, request.mediaType);
          sendResponse({ success: true, data: apiDebugResult });
          break;
        }

        case 'getMediaStatus': {
          const statusResult = await this.getMediaStatus(request.data);
          sendResponse({ success: true, data: statusResult });
          break;
        }

        case 'reloadSettings': {
          await this.loadSettings();
          await this.syncOverlayRegistration();
          sendResponse({ success: true, data: 'Settings reloaded' });
          break;
        }

        // The overlay must never hold the API key, so it asks whether requests
        // are available rather than reading the secret itself.
        case 'getConfigState': {
          sendResponse({ success: true, data: { apiConfigured: !!(this.baseUrl && this.apiKey), serverUrl: this.baseUrl ?? null } });
          break;
        }

        case 'addToWatchlist': {
          const watchlistResult = await this.addToWatchlist(request.data);
          sendResponse({ success: true, data: watchlistResult });
          break;
        }

        case 'getRottenTomatoesRatings': {
          const rtResult = await this.getRottenTomatoesRatings(request.data || {});
          sendResponse({ success: true, data: rtResult });
          break;
        }

        default:
          sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (error) {
      console.error('Background script error:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  async requestMedia(mediaData) {
    if (!this.baseUrl || !this.apiKey) {
      throw new Error('Seerr server URL and API key are required. Please configure them in the extension options.');
    }

    this.log('🎬 [Background] Requesting media:', mediaData);

    // Use TMDB ID directly if provided — skip search entirely
    let tmdbId = mediaData.tmdbId ? parseInt(mediaData.tmdbId) : null;
    if (tmdbId && !isNaN(tmdbId)) {
      this.log('✅ [Background] Using provided TMDB ID:', tmdbId);
    } else {
      // No TMDB ID provided — do a title search
      const searchTerms = this.generateSearchTerms(mediaData.title);
      this.log('🔍 [Background] Generated search terms:', searchTerms);

      let searchResults = [];
      let bestMatch = null;

      for (const searchTerm of searchTerms) {
        try {
          this.log('🔍 [Background] Searching for:', searchTerm, 'type:', mediaData.mediaType);
          searchResults = await this.searchMedia(searchTerm, mediaData.mediaType);
          this.log('🔍 [Background] Search results for "' + searchTerm + '":', searchResults.length, 'items');

          bestMatch = this.findBestMatch(searchResults, { ...mediaData, title: searchTerm });
          this.log('🎯 [Background] Best match for "' + searchTerm + '":', bestMatch);

          if (bestMatch) {
            tmdbId = parseInt(bestMatch.id);
            this.log('✅ [Background] Using TMDB ID:', tmdbId, 'from search term:', searchTerm);
            break;
          }
        } catch (searchError) {
          this.warn('⚠️ [Background] Search failed for "' + searchTerm + '":', searchError);
          continue;
        }
      }

      if (!bestMatch) {
        throw new Error(`Could not find "${mediaData.title}" in Seerr database. Tried search terms: ${searchTerms.join(', ')}`);
      }
    }

    if (!tmdbId || isNaN(tmdbId)) {
      throw new Error(`Invalid TMDB ID: ${tmdbId}. Could not request media.`);
    }

    const requestData = {
      mediaType: mediaData.mediaType,
      mediaId: tmdbId,
      tvdbId: undefined,
      seasons: mediaData.mediaType === 'tv' ? 'all' : undefined
    };

    this.log('📡 [Background] Sending request to Seerr:', requestData);
    const response = await this.makeAPIRequest('POST', '/api/v1/request', requestData);
    this.log('✅ [Background] Request successful:', response);

    return {
      id: response.id,
      mediaType: response.type,
      status: response.status,
      title: mediaData.title
    };
  }

  generateSearchTerms(originalTitle) {
    this.log('🔍 [Background] generateSearchTerms called with:', originalTitle);
    const terms = [originalTitle];

    // Digit/word swaps target standalone numerals such as "Toy Story 2".
    // Without the word boundaries these rewrote digits inside numbers, turning
    // "Blade Runner 2049" into "Blade Runner Two0Four9" — a wasted request that
    // could also fuzzy-match the wrong title.
    const numberWords = [['2', 'Two'], ['3', 'Three'], ['4', 'Four']];
    const variations = [
      originalTitle.replace(/Se7en/gi, 'Seven'),
      originalTitle.replace(/Seven/gi, 'Se7en'),
      ...numberWords.flatMap(([digit, word]) => [
        originalTitle.replace(new RegExp(`\\b${digit}\\b`, 'g'), word),
        originalTitle.replace(new RegExp(`\\b${word}\\b`, 'gi'), digit)
      ]),
      originalTitle.replace(/[^a-zA-Z0-9\s]/g, ''),
      originalTitle.replace(/^(The|A|An)\s+/i, ''),
      originalTitle.split(':')[0].trim(),
      originalTitle.split(' - ')[0].trim(),
      originalTitle.split(' –')[0].trim(),
      originalTitle.replace(/\s*\(\d{4}\)\s*$/, ''),
      originalTitle.replace(/'/g, "'"),
      originalTitle.replace(/′/g, "'"),  // prime → straight quote (TMDb specific)
      originalTitle.replace(/\s+for\s+/gi, ' '),
      originalTitle.replace(/\s+(for|of|the|and|in|on|at|to)\s+/gi, ' ').replace(/\s+/g, ' ').trim()
    ];

    this.log('🔍 [Background] Initial variations generated:', variations.length);

    variations.forEach((variation, index) => {
      const cleaned = variation.trim();
      this.log(`🔍 [Background] Variation ${index}: "${variation}" -> cleaned: "${cleaned}"`);
      if (cleaned && cleaned !== originalTitle && !terms.includes(cleaned)) {
        terms.push(cleaned);
        this.log('🔍 [Background] Added variation:', cleaned);
      }
    });

    this.log('🔍 [Background] Final search terms:', terms);
    return terms;
  }

  findBestMatch(searchResults, mediaData) {
    if (!searchResults || searchResults.length === 0) {
      return null;
    }

    const typeFiltered = searchResults.filter(result => result.mediaType === mediaData.mediaType);
    const candidateResults = typeFiltered.length > 0 ? typeFiltered : searchResults;

    const searchTitle = mediaData.title.toLowerCase();

    let exactMatch = candidateResults.find(result => {
      const titles = [
        result.title?.toLowerCase(),
        result.originalTitle?.toLowerCase(),
        result.name?.toLowerCase(),
        result.originalName?.toLowerCase()
      ].filter(Boolean);

      return titles.some(title => title === searchTitle);
    });

    if (exactMatch) {
      if (mediaData.year) {
        const releaseYear = this.extractYear(exactMatch.releaseDate || exactMatch.firstAirDate);
        if (releaseYear && Math.abs(releaseYear - mediaData.year) <= 1) {
          return exactMatch;
        }
      } else {
        return exactMatch;
      }
    }

    const partialMatch = candidateResults.find(result => {
      const titles = [
        result.title?.toLowerCase(),
        result.originalTitle?.toLowerCase(),
        result.name?.toLowerCase(),
        result.originalName?.toLowerCase()
      ].filter(Boolean);

      return titles.some(title => {
        return title.includes(searchTitle) || searchTitle.includes(title) ||
               this.areTitlesSimilar(title, searchTitle);
      });
    });

    if (partialMatch) {
      if (mediaData.year) {
        const releaseYear = this.extractYear(partialMatch.releaseDate || partialMatch.firstAirDate);
        if (releaseYear && Math.abs(releaseYear - mediaData.year) <= 2) {
          return partialMatch;
        }
      } else {
        return partialMatch;
      }
    }

    if (mediaData.year) {
      const yearMatches = candidateResults.filter(result => {
        const releaseYear = this.extractYear(result.releaseDate || result.firstAirDate);
        return releaseYear && Math.abs(releaseYear - mediaData.year) <= 1;
      });

      if (yearMatches.length > 0) {
        return yearMatches[0];
      }
    }

    return candidateResults[0];
  }

  areTitlesSimilar(title1, title2) {
    const normalize = (str) => str.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const norm1 = normalize(title1);
    const norm2 = normalize(title2);

    if (norm1 === norm2) return true;

    const substitutions = [
      ['seven', 'se7en'], ['two', '2'], ['three', '3'], ['four', '4'],
      ['five', '5'], ['six', '6'], ['eight', '8'], ['nine', '9'], ['ten', '10']
    ];

    for (const [word, num] of substitutions) {
      if ((norm1.includes(word) && norm2.includes(num)) ||
          (norm1.includes(num) && norm2.includes(word))) {
        return true;
      }
    }

    return false;
  }

  extractYear(dateString) {
    if (!dateString) return null;
    const year = parseInt(dateString.substring(0, 4));
    return isNaN(year) ? null : year;
  }

  async searchMedia(query, mediaType = 'movie') {
    if (!this.baseUrl || !this.apiKey) {
      throw new Error('Seerr server URL and API key are required');
    }

    const response = await this.makeAPIRequest('GET', `/api/v1/search?query=${encodeURIComponent(query)}&page=1&language=en`);

    if (mediaType) {
      return response.results?.filter(result => result.mediaType === mediaType) || [];
    }

    return response.results || [];
  }

  async debugSearch(title, mediaType = 'movie') {
    this.log('🔍 [Background] Debug search for:', title, 'type:', mediaType);

    const searchTerms = this.generateSearchTerms(title);
    const results = [];

    for (const searchTerm of searchTerms) {
      try {
        const searchResults = await this.searchMedia(searchTerm, mediaType);
        results.push({
          searchTerm,
          resultCount: searchResults.length,
          results: searchResults.slice(0, 3)
        });
        this.log(`🔍 [Background] Debug: "${searchTerm}" -> ${searchResults.length} results`);
      } catch (error) {
        results.push({ searchTerm, error: error.message });
      }
    }

    return { searchTerms, results };
  }

  async getMediaStatus(mediaData) {
    this.log('📊 [Background] Getting media status for:', mediaData);
    this.log('📊 [Background] API Config - baseUrl:', this.baseUrl, 'apiKey:', this.apiKey ? '[SET]' : '[NOT SET]');

    if (!this.baseUrl || !this.apiKey) {
      this.warn('📊 [Background] Missing API configuration');
      throw new Error('Seerr server URL and API key are required');
    }

    try {
      // The page usually already knows the TMDB id. Trust it rather than
      // running up to 19 fuzzy title searches that can resolve to the wrong
      // title — requestMedia has always taken this shortcut.
      const knownTmdbId = parseInt(mediaData.tmdbId, 10);
      if (Number.isInteger(knownTmdbId) && knownTmdbId > 0) {
        this.log('📊 [Background] Using provided TMDB ID, skipping search:', knownTmdbId);
        const details = await this.getMediaDetails(knownTmdbId, mediaData.mediaType);
        return this.formatMediaStatus(details, mediaData.mediaType);
      }

      this.log('📊 [Background] Starting search for title:', mediaData.title, 'type:', mediaData.mediaType);
      const searchTerms = this.generateSearchTerms(mediaData.title);
      this.log('📊 [Background] Generated search terms:', searchTerms);
      let bestMatch = null;
      let searchResults = [];

      for (let i = 0; i < searchTerms.length; i++) {
        const searchTerm = searchTerms[i];
        try {
          this.log(`📊 [Background] Searching term ${i + 1}/${searchTerms.length}: "${searchTerm}"`);
          searchResults = await this.searchMedia(searchTerm, mediaData.mediaType);
          this.log(`📊 [Background] Search results for "${searchTerm}":`, searchResults.length, 'items');

          if (searchResults.length > 0) {
            this.log('📊 [Background] First few results:', searchResults.slice(0, 3).map(r => ({
              id: r.id, title: r.title || r.name, year: r.releaseDate || r.firstAirDate, mediaType: r.mediaType
            })));
          }

          bestMatch = this.findBestMatch(searchResults, { ...mediaData, title: searchTerm });
          this.log(`📊 [Background] Best match for "${searchTerm}":`, bestMatch ? {
            id: bestMatch.id, title: bestMatch.title || bestMatch.name, mediaType: bestMatch.mediaType
          } : 'none');

          if (bestMatch) {
            this.log('📊 [Background] ✅ Found best match, breaking search loop');
            break;
          }
        } catch (error) {
          this.warn(`📊 [Background] Search failed for "${searchTerm}":`, error.message);
          continue;
        }
      }

      if (!bestMatch) {
        this.log('📊 [Background] ❌ No media found after trying all search terms');
        this.log('📊 [Background] Returning available status (not in database)');
        return {
          status: 'available',
          message: 'Ready to request',
          buttonText: 'Request on Seerr',
          buttonClass: 'request'
        };
      }

      const tmdbId = parseInt(bestMatch.id);
      this.log('📊 [Background] ✅ Found media with TMDB ID:', tmdbId);

      this.log('📊 [Background] Fetching detailed status...');
      const mediaDetails = await this.getMediaDetails(tmdbId, mediaData.mediaType);
      this.log('📊 [Background] Media details response:', mediaDetails);

      const formattedStatus = this.formatMediaStatus(mediaDetails, mediaData.mediaType);
      this.log('📊 [Background] Final formatted status:', formattedStatus);

      return formattedStatus;

    } catch (error) {
      console.error('📊 [Background] ❌ Error getting media status:', error);
      console.error('📊 [Background] Error stack:', error.stack);
      return {
        status: 'error',
        message: 'Connection issue',
        buttonText: 'Request on Seerr',
        buttonClass: 'request'
      };
    }
  }

  async getMediaDetails(tmdbId, mediaType) {
    this.log(`📊 [Background] Getting media details for TMDB ID ${tmdbId} (${mediaType})`);

    this.log('📊 [Background] Checking requests first for accurate status...');
    const requestResult = await this.searchRequests(tmdbId, mediaType);

    if (requestResult) {
      this.log('📊 [Background] Found in requests, using request status');
      return requestResult;
    }

    try {
      const endpoint = mediaType === 'tv' ? `/api/v1/tv/${tmdbId}` : `/api/v1/movie/${tmdbId}`;
      this.log(`📊 [Background] Not in requests, trying direct lookup: ${endpoint}`);

      const response = await this.makeAPIRequest('GET', endpoint);
      this.log('📊 [Background] Direct lookup response:', response);

      return response;

    } catch (error) {
      this.log(`📊 [Background] Direct lookup failed (${error.message})`);
      return null;
    }
  }

  async searchRequests(tmdbId, mediaType) {
    try {
      this.log(`📊 [Background] Searching requests for TMDB ID ${tmdbId} (${mediaType})`);
      const response = await this.makeAPIRequest('GET', '/api/v1/request?take=100&skip=0');
      this.log('📊 [Background] Requests API response:', response);

      const requests = response.results || response || [];
      this.log(`📊 [Background] Found ${requests.length} total requests`);

      if (requests.length > 0) {
        this.log('📊 [Background] Sample requests:', requests.slice(0, 3).map(r => ({
          id: r.id, type: r.type, status: r.status,
          mediaId: r.media?.tmdbId || r.media?.id,
          title: r.media?.title || r.media?.name
        })));
      }

      const matchingRequest = requests.find(request => {
        const requestMediaType = request.type === 'movie' ? 'movie' : 'tv';
        const matchesType = requestMediaType === mediaType;
        // Only tmdbId identifies the title. request.media.id is Seerr's own
        // sequential row id, and comparing it here matched an unrelated
        // request whenever some row's id happened to equal this TMDB id —
        // which is common, since both are small integers.
        const matchesTmdbId = Number(request.media?.tmdbId) === Number(tmdbId);

        this.log(`📊 [Background] Checking request:`, {
          requestId: request.id, requestType: requestMediaType, matchesType,
          tmdbId: request.media?.tmdbId, matchesTmdbId,
          title: request.media?.title || request.media?.name
        });

        return matchesType && matchesTmdbId;
      });

      if (matchingRequest) {
        this.log('📊 [Background] ✅ Found matching request:', {
          id: matchingRequest.id, type: matchingRequest.type,
          status: matchingRequest.status,
          title: matchingRequest.media?.title || matchingRequest.media?.name
        });

        return {
          ...matchingRequest,
          media: matchingRequest.media,
          mediaType: matchingRequest.type
        };
      }

      this.log('📊 [Background] ❌ No matching request found');
      return null;
    } catch (error) {
      console.error('📊 [Background] Could not search requests:', error);
      return null;
    }
  }

  formatMediaStatus(mediaDetails, mediaType) {
    if (!mediaDetails) {
      return {
        status: 'available',
        message: 'Ready to request',
        buttonText: 'Request on Seerr',
        buttonClass: 'request'
      };
    }

    this.log('📊 [Background] Raw mediaDetails for status formatting:');
    this.log('📊 [Background] mediaDetails.status:', mediaDetails.status);
    this.log('📊 [Background] mediaDetails.media:', mediaDetails.media ? {
      status: mediaDetails.media.status,
      tmdbId: mediaDetails.media.tmdbId,
      mediaUrl: mediaDetails.media.mediaUrl ? '[HAS_URL]' : null,
      seasons: mediaDetails.media.seasons ? mediaDetails.media.seasons.length : null,
      episodeCount: mediaDetails.media.episodeCount,
      inProduction: mediaDetails.media.inProduction,
      firstAirDate: mediaDetails.media.firstAirDate,
      lastAirDate: mediaDetails.media.lastAirDate,
      status: mediaDetails.media.status
    } : null);
    this.log('📊 [Background] mediaDetails.mediaInfo:', mediaDetails.mediaInfo ? {
      status: mediaDetails.mediaInfo.status,
      inProduction: mediaDetails.mediaInfo.inProduction,
      seasons: mediaDetails.mediaInfo.seasons
    } : null);
    this.log('📊 [Background] mediaDetails.requests:', mediaDetails.requests ? mediaDetails.requests.length + ' requests' : null);

    this.log('📊 [Background] Full object keys for monitoring detection:', Object.keys(mediaDetails));
    if (mediaDetails.seasons) {
      this.log('📊 [Background] Seasons data available:', mediaDetails.seasons.length);
    }

    let status = null;
    let mediaUrl = null;
    let serviceUrl = null;
    // Seerr has two status enums. A request carries MediaRequestStatus
    // (pending/approved/declined/failed/completed) while media carries
    // MediaStatus (unknown/pending/processing/partial/available/
    // blocklisted/deleted). The same number means different things.
    let statusKind = 'media';

    if (mediaDetails.status !== undefined && mediaDetails.media) {
      status = mediaDetails.status;
      statusKind = 'request';
      mediaUrl = mediaDetails.media.mediaUrl;
      serviceUrl = mediaDetails.media.serviceUrl;
      this.log('📊 [Background] Found REQUEST object with status:', status);
      this.log('📊 [Background] Media has status', mediaDetails.media.status, 'but using request status', status);
    } else if (mediaDetails.requests && mediaDetails.requests.length > 0) {
      const latestRequest = mediaDetails.requests[0];
      status = latestRequest.status;
      statusKind = 'request';
      if (latestRequest.media) {
        mediaUrl = latestRequest.media.mediaUrl;
        serviceUrl = latestRequest.media.serviceUrl;
      }
      this.log('📊 [Background] Found status in requests array:', status);
    } else if (mediaDetails.mediaInfo && mediaDetails.mediaInfo.status !== undefined) {
      status = mediaDetails.mediaInfo.status;
      mediaUrl = mediaDetails.mediaInfo.mediaUrl;
      serviceUrl = mediaDetails.mediaInfo.serviceUrl;
      this.log('📊 [Background] Found status in mediaInfo:', status);
    } else if (mediaDetails.media && mediaDetails.media.status !== undefined) {
      status = mediaDetails.media.status;
      mediaUrl = mediaDetails.media.mediaUrl;
      serviceUrl = mediaDetails.media.serviceUrl;
      this.log('📊 [Background] Found status in media object:', status);
    } else if (mediaDetails.status !== undefined) {
      status = mediaDetails.status;
      this.log('📊 [Background] Found direct status:', status);
    }

    this.log('📊 [Background] Final extracted status:', status);
    this.log('📊 [Background] Media URLs - mediaUrl:', mediaUrl, 'serviceUrl:', serviceUrl);

    if (status === null || status === undefined) {
      this.log('📊 [Background] No status found, returning available for request');
      return {
        status: 'available',
        message: 'Not requested',
        buttonText: 'Request on Seerr',
        buttonClass: 'request'
      };
    }

    let result = {
      tmdbId: mediaDetails.id || mediaDetails.tmdbId,
      title: mediaDetails.name || mediaDetails.title || 'Unknown Title',
      status: 'unknown',
      message: 'Status unknown',
      buttonText: 'Request on Seerr',
      buttonClass: 'request'
    };

    if (mediaUrl) result.watchUrl = mediaUrl;
    if (serviceUrl) result.serviceUrl = serviceUrl;

    this.log('📊 [Background] Mapping', statusKind, 'status:', status, '(type:', typeof status, ') to UI format');
    this.log('📊 [Background] Raw status value for debugging:', JSON.stringify(status));

    const numericStatus = parseInt(status);
    if (isNaN(numericStatus)) {
      this.warn('📊 [Background] Unparseable status value:', status, 'treating as unknown');
      result.status = 'unknown';
      result.message = 'Status unavailable';
      result.buttonText = 'Request on Seerr';
      result.buttonClass = 'request';
      this.log('📊 [Background] Formatted status:', result);
      return result;
    }
    this.log('📊 [Background] Numeric status:', numericStatus);

    if (statusKind === 'request') this.applyRequestStatus(result, numericStatus, mediaUrl);
    else this.applyMediaStatus(result, numericStatus, mediaUrl, mediaDetails);

    const monitoringInfo = this.detectMonitoringStatus(mediaDetails, mediaType);
    if (monitoringInfo) {
      result.monitoring = monitoringInfo;
      this.log('📊 [Background] Monitoring info:', monitoringInfo);
    }

    this.log('📊 [Background] Formatted status:', result);
    return result;
  }

  // MediaRequestStatus: 1 pending, 2 approved, 3 declined, 4 failed,
  // 5 completed. These describe the request, not whether media exists.
  applyRequestStatus(result, status, mediaUrl) {
    switch (status) {
      case 1:
        result.status = 'pending';
        result.message = 'Request awaiting approval';
        result.buttonText = 'Request Pending';
        result.buttonClass = 'pending';
        break;

      case 2:
        result.status = 'pending';
        result.message = 'Request approved';
        result.buttonText = 'Request Approved';
        result.buttonClass = 'pending';
        break;

      case 3:
        result.status = 'declined';
        result.message = 'Request declined';
        result.buttonText = 'Request Declined';
        result.buttonClass = 'error';
        break;

      case 4:
        // Offer a retry: a failed request is the one case where requesting
        // again is the useful action.
        result.status = 'failed';
        result.message = 'Request failed';
        result.buttonText = 'Try Again';
        result.buttonClass = 'request';
        break;

      case 5:
        result.status = 'available_watch';
        result.message = this.availableMessage();
        result.buttonText = 'Available';
        result.buttonClass = 'available';
        if (mediaUrl) {
          result.watchUrl = mediaUrl;
          result.buttonText = this.watchButtonText();
          result.buttonClass = 'watch';
        }
        break;

      default:
        this.log('📊 [Background] Unknown request status:', status, 'treating as requestable');
        result.status = 'available';
        result.message = 'Ready to request';
        result.buttonText = 'Request on Seerr';
        result.buttonClass = 'request';
        break;
    }
    return result;
  }

  // MediaStatus: 1 unknown, 2 pending, 3 processing, 4 partially available,
  // 5 available, 6 blocklisted, 7 deleted.
  applyMediaStatus(result, status, mediaUrl, mediaDetails) {
    switch (status) {
      case 1:
        // Seerr treats UNKNOWN as "not requested" and offers the request.
        result.status = 'available';
        result.message = 'Ready to request';
        result.buttonText = 'Request on Seerr';
        result.buttonClass = 'request';
        break;

      case 2:
        result.status = 'pending';
        result.message = 'Request monitoring';
        result.buttonText = 'Request Pending';
        result.buttonClass = 'pending';
        break;

      case 3: {
        result.status = 'downloading';
        result.message = 'Processing download';
        result.buttonText = 'Processing...';
        result.buttonClass = 'downloading';

        const progress = this.extractDownloadProgress(mediaDetails);
        Object.assign(result, progress);
        if (progress.progress !== undefined) {
          result.message = `Download in progress (${progress.progress}%)`;
          result.buttonText = `Downloading ${progress.progress}%`;
        }
        break;
      }

      case 4:
        result.status = 'partial';
        result.message = 'Partially ready';
        result.buttonText = 'Partially Available';
        result.buttonClass = 'partial';
        if (mediaUrl) {
          result.message = this.availableMessage();
          result.watchUrl = mediaUrl;
          result.buttonText = this.watchButtonText();
          result.buttonClass = 'watch';
        }
        break;

      case 5:
        result.status = 'available_watch';
        result.message = this.availableMessage();
        result.buttonText = 'Available';
        result.buttonClass = 'available';
        if (mediaUrl) {
          result.watchUrl = mediaUrl;
          result.buttonText = this.watchButtonText();
          result.buttonClass = 'watch';
        }
        break;

      case 6:
        // Blocklisted on the server; requesting it cannot succeed.
        result.status = 'blocklisted';
        result.message = 'Blocklisted on Seerr';
        result.buttonText = 'Blocklisted';
        result.buttonClass = 'error';
        break;

      case 7:
        // Removed from the library, so requesting it again is the right offer.
        result.status = 'available';
        result.message = 'Ready to request';
        result.buttonText = 'Request on Seerr';
        result.buttonClass = 'request';
        break;

      default:
        this.log('📊 [Background] Unknown media status:', status, 'treating as available');
        result.status = 'available';
        result.message = 'Ready to request';
        result.buttonText = 'Request on Seerr';
        result.buttonClass = 'request';
        break;
    }
    return result;
  }

  // Seerr does not document download progress fields, so these are probed.
  extractDownloadProgress(mediaDetails) {
    const found = {};
    if (!mediaDetails) return found;
    const groups = {
      progress: ['progress', 'percentage', 'downloadProgress', 'completion', 'percent'],
      downloadSpeed: ['speed', 'downloadSpeed', 'rate', 'transferRate'],
      eta: ['eta', 'timeRemaining', 'estimatedCompletion', 'remainingTime'],
      downloadClient: ['downloadClient', 'downloader', 'client']
    };
    for (const [key, fields] of Object.entries(groups)) {
      for (const field of fields) {
        if (mediaDetails[field] !== undefined) found[key] = mediaDetails[field];
      }
    }
    return found;
  }

  detectMonitoringStatus(mediaDetails, mediaType) {
    if (!mediaDetails) return null;

    if (mediaType === 'tv') {
      const media = mediaDetails.media || mediaDetails.mediaInfo || mediaDetails;

      if (media.inProduction === true) {
        return { type: 'future_episodes', message: 'Monitoring new episodes', indicator: '📡' };
      }

      if (media.seasons && Array.isArray(media.seasons)) {
        const incompleteSeasons = media.seasons.filter(season => season.status !== 5);
        if (incompleteSeasons.length > 0) {
          return { type: 'future_seasons', message: `Monitoring ${incompleteSeasons.length} season(s)`, indicator: '📡' };
        }
      }
    }

    if (mediaType === 'movie') {
      const media = mediaDetails.media || mediaDetails.mediaInfo || mediaDetails;
      if (media.belongsToCollection && media.inProduction) {
        return { type: 'future_collection', message: 'Monitoring collection', indicator: '📡' };
      }
    }

    return null;
  }

  normalizeTitleForMatch(title = '') {
    return String(title)
      .toLowerCase()
      .replace(/&amp;/g, '&')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\b(the|a|an)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  decodeHtml(text = '') {
    return String(text)
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
  }

  parseRtSearchResults(html, mediaType) {
    const rows = [];
    const rowRe = /<search-page-media-row\b([\s\S]*?)<\/search-page-media-row>/gi;
    let match;

    while ((match = rowRe.exec(html))) {
      const row = match[0];
      const attrs = match[1] || '';
      const hrefMatch = row.match(/<a[^>]+data-qa="info-name"[^>]+href="([^"]+)"/i) ||
        row.match(/<a[^>]+href="([^"]+)"[^>]+data-qa="info-name"/i);
      const titleMatch = row.match(/<a[^>]+data-qa="info-name"[^>]*>([\s\S]*?)<\/a>/i);
      const yearMatch = attrs.match(/(?:release-year|start-year)="(\d{4})"/i);
      const criticsMatch = attrs.match(/tomatometer-score="(\d{1,3})"/i);

      if (!hrefMatch || !titleMatch) continue;

      const href = this.decodeHtml(hrefMatch[1]);
      const resultType = href.includes('/tv/') ? 'tv' : 'movie';
      if (mediaType && resultType !== mediaType) continue;

      rows.push({
        href,
        title: this.decodeHtml(titleMatch[1].replace(/<[^>]*>/g, '')).trim(),
        year: yearMatch ? parseInt(yearMatch[1], 10) : null,
        mediaType: resultType,
        rtCriticsScore: criticsMatch ? this.parseRtPercent(criticsMatch[1]) : null
      });
    }

    return rows;
  }

  scoreRtSearchResult(result, requested) {
    const requestedTitle = this.normalizeTitleForMatch(requested.title);
    const resultTitle = this.normalizeTitleForMatch(result.title);
    if (!requestedTitle || !resultTitle) return 0;

    let score = 0;
    if (requestedTitle === resultTitle) {
      score = 0.82;
    } else if (requestedTitle.includes(resultTitle) || resultTitle.includes(requestedTitle)) {
      score = 0.68;
    } else {
      const requestedWords = new Set(requestedTitle.split(' ').filter(Boolean));
      const resultWords = new Set(resultTitle.split(' ').filter(Boolean));
      const overlap = [...requestedWords].filter(word => resultWords.has(word)).length;
      score = overlap / Math.max(requestedWords.size, resultWords.size) * 0.7;
    }

    if (requested.year && result.year) {
      const delta = Math.abs(requested.year - result.year);
      if (delta === 0) score += 0.15;
      else if (delta <= 1) score += 0.08;
      else if (delta >= 3) score -= 0.25;
    }

    return Math.max(0, Math.min(1, score));
  }

  parseRtScorecard(html) {
    const scriptMatch = html.match(/<script[^>]+id="media-scorecard-json"[^>]*>([\s\S]*?)<\/script>/i);
    if (!scriptMatch) return {};

    try {
      const data = JSON.parse(scriptMatch[1].trim());
      return {
        rtCriticsScore: this.parseRtPercent(data.criticsScore?.score),
        rtAudienceScore: this.parseRtPercent(data.audienceScore?.score)
      };
    } catch (error) {
      this.warn('Could not parse Rotten Tomatoes scorecard:', error);
      return {};
    }
  }

  parseRtPercent(value) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const score = Number(String(value).replace(/%$/, ''));
    return Number.isFinite(score) && score >= 0 && score <= 100 ? Math.round(score) : null;
  }

  async fetchRtHtml(url) {
    const target = new URL(url, 'https://www.rottentomatoes.com');
    if (target.origin !== 'https://www.rottentomatoes.com' || target.username || target.password) {
      throw new Error('Rotten Tomatoes URL is outside the allowed origin');
    }
    const response = await fetch(target.href, {
      redirect: 'error',
      signal: AbortSignal.timeout(RatingsConfig.requestTimeoutMs),
      credentials: 'omit',
      headers: {
        Accept: 'text/html,application/xhtml+xml'
      }
    });
    if (!response.ok) {
      throw new Error(`Rotten Tomatoes returned HTTP ${response.status}`);
    }
    return response.text();
  }

  cacheRottenTomatoesResult(key, value, ttl) {
    this.rtCache.delete(key);
    while (this.rtCache.size >= RatingsConfig.rtCacheMaxEntries) this.rtCache.delete(this.rtCache.keys().next().value);
    this.rtCache.set(key, { value, expiresAt: Date.now() + ttl });
    this.scheduleRtCacheFlush();
  }

  // ── Persisted RT cache ──
  // The worker is evicted after seconds of idle, so an in-memory Map alone can
  // never honour rtCacheTtlMs. storage.local carries entries across restarts.

  loadRtCache() {
    this.rtCacheReady ??= (async () => {
      try {
        const stored = (await chrome.storage.local.get([RT_CACHE_STORAGE_KEY]))[RT_CACHE_STORAGE_KEY];
        if (!stored || typeof stored !== 'object') return;
        const now = Date.now();
        for (const [key, entry] of Object.entries(stored)) {
          // A live in-memory entry is newer than anything on disk.
          if (this.rtCache.has(key)) continue;
          if (!entry || typeof entry !== 'object' || typeof entry.expiresAt !== 'number') continue;
          if (now >= entry.expiresAt) continue;
          this.rtCache.set(key, { value: entry.value ?? null, expiresAt: entry.expiresAt });
        }
      } catch (error) {
        console.error('Could not read the persisted Rotten Tomatoes cache:', error);
      }
    })();
    return this.rtCacheReady;
  }

  scheduleRtCacheFlush() {
    if (this.rtCacheFlushTimer !== null) return;
    this.rtCacheFlushTimer = setTimeout(() => {
      this.rtCacheFlushTimer = null;
      this.flushRtCache();
    }, RT_CACHE_FLUSH_DELAY_MS);
  }

  // Serialised so overlapping flushes cannot interleave their writes.
  flushRtCache() {
    this.rtCacheFlushing = (this.rtCacheFlushing ?? Promise.resolve()).then(async () => {
      try {
        const now = Date.now();
        const payload = {};
        for (const [key, entry] of this.rtCache) {
          if (now < entry.expiresAt) payload[key] = entry;
        }
        await chrome.storage.local.set({ [RT_CACHE_STORAGE_KEY]: payload });
      } catch (error) {
        console.error('Could not persist the Rotten Tomatoes cache:', error);
      }
    });
    return this.rtCacheFlushing;
  }

  async getRottenTomatoesRatings(data) {
    const title = typeof data?.title === 'string' ? data.title.trim() : '';
    if (!title) return null;
    const refresh = data?.refresh === true;
    const normalized = { ...data, title, mediaType: data.mediaType || 'movie', refresh };
    // A refresh coalesces with other refreshes but must not join an ordinary
    // lookup already in flight, which would hand back the stale value.
    const key = `${refresh ? 'refresh:' : ''}${normalized.mediaType}:${title}:${normalized.year || ''}`;
    if (this.rtPending.has(key)) return this.rtPending.get(key);
    const pending = this.resolveRottenTomatoesRatings(normalized);
    this.rtPending.set(key, pending);
    try { return await pending; }
    finally { this.rtPending.delete(key); }
  }

  async resolveRottenTomatoesRatings({ title, year = null, mediaType = 'movie', refresh = false }) {
    if (!title) return null;

    await this.loadRtCache();

    const cacheKey = `${mediaType}:${title}:${year || ''}`;
    // Scores move as reviews arrive, so a refresh discards what we hold and
    // refetches; the new value then becomes the cached one.
    if (refresh) this.rtCache.delete(cacheKey);
    const cached = this.rtCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) return cached.value;

    // Bound the worker cache during long browsing sessions. Insertion enforces
    // the hard limit; this only clears entries that have already expired.
    for (const [key, entry] of this.rtCache) if (Date.now() >= entry.expiresAt) this.rtCache.delete(key);
    const searchUrl = `https://www.rottentomatoes.com/search?search=${encodeURIComponent(title)}`;
    const searchHtml = await this.fetchRtHtml(searchUrl);
    const candidates = this.parseRtSearchResults(searchHtml, mediaType)
      .map(result => ({
        ...result,
        confidence: this.scoreRtSearchResult(result, { title, year })
      }))
      .sort((a, b) => b.confidence - a.confidence);

    const best = candidates[0];
    if (!best || best.confidence < RatingsConfig.confidenceThreshold) {
      const empty = null;
      this.cacheRottenTomatoesResult(cacheKey, empty, RatingsConfig.rtNegativeCacheTtlMs);
      return empty;
    }

    let detailScores = {};
    try {
      detailScores = this.parseRtScorecard(await this.fetchRtHtml(best.href));
    } catch (error) {
      this.warn('Could not fetch Rotten Tomatoes detail page:', error);
    }

    const result = {
      rtCriticsScore: detailScores.rtCriticsScore ?? best.rtCriticsScore ?? null,
      rtAudienceScore: detailScores.rtAudienceScore ?? null,
      confidence: best.confidence,
      source: 'rotten-tomatoes',
      url: best.href,
      matchedTitle: best.title,
      matchedYear: best.year
    };

    const ttl = result.rtCriticsScore === null && result.rtAudienceScore === null
      ? RatingsConfig.rtNegativeCacheTtlMs : RatingsConfig.rtCacheTtlMs;
    this.cacheRottenTomatoesResult(cacheKey, result, ttl);
    return result;
  }

  async debugAPI(tmdbId, mediaType) {
    this.log(`🛠️ [Background] Debugging API endpoints for TMDB ID ${tmdbId} (${mediaType})`);
    const results = {};

    try {
      const endpoints = [
        `/api/v1/${mediaType}/${tmdbId}`,
        `/api/v1/request`,
        `/api/v1/request?take=10&skip=0`,
        `/api/v1/media/${tmdbId}`,
        `/api/v1/search?query=The Wire`,
      ];

      for (const endpoint of endpoints) {
        try {
          this.log(`🛠️ [Background] Testing endpoint: ${endpoint}`);
          const response = await this.makeAPIRequest('GET', endpoint);
          results[endpoint] = {
            success: true,
            dataType: Array.isArray(response) ? 'array' : typeof response,
            hasResults: response.results ? response.results.length : 'no results field',
            keys: Object.keys(response).slice(0, 10),
            sample: endpoint.includes('request') ? (response.results || response)?.slice(0, 2) : response
          };
          this.log(`🛠️ [Background] ${endpoint} - SUCCESS:`, results[endpoint]);
        } catch (error) {
          results[endpoint] = { success: false, error: error.message };
          this.log(`🛠️ [Background] ${endpoint} - FAILED:`, error.message);
        }
      }

      return results;

    } catch (error) {
      console.error('🛠️ [Background] API debug failed:', error);
      return { error: error.message };
    }
  }

  async testConnection() {
    if (!this.baseUrl || !this.apiKey) {
      throw new Error('Server URL and API key are required');
    }

    try {
      const response = await this.makeAPIRequest('GET', '/api/v1/auth/me');
      return {
        connected: true,
        user: response.displayName || response.email,
        server: this.baseUrl
      };
    } catch (error) {
      throw new Error(`Connection failed: ${error.message}`);
    }
  }

  async addToWatchlist(data) {
    if (!this.baseUrl || !this.apiKey) {
      throw new Error('Seerr server URL and API key are required');
    }
    const response = await this.makeAPIRequest('POST', '/api/v1/watchlist', {
      mediaType: data.mediaType,
      mediaId: data.tmdbId
    });
    return response;
  }

  async makeAPIRequest(method, endpoint, data = null) {
    if (!this.baseUrl || !this.apiKey) {
      throw new Error('Server URL and API key must be configured');
    }

    const url = `${this.baseUrl.replace(/\/$/, '')}${endpoint}`;
    const options = {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(RatingsConfig.requestTimeoutMs),
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': this.apiKey
      }
    };

    if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      options.body = JSON.stringify(data);
    }

    try {
      const response = await fetch(url, options);

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        try {
          const errorData = await response.json();
          if (errorData.message) errorMessage = errorData.message;
        } catch (_) {}
        throw new Error(errorMessage);
      }

      return response.status === 204 ? null : await response.json();
    } catch (error) {
      if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
        throw new Error('Could not connect to Seerr server. Please check the URL and your network connection.');
      }
      throw error;
    }
  }

  updateSettings(settings) {
    this.baseUrl = settings.seerrUrl;
    this.apiKey = settings.seerrApiKey;
    this.updateIconBadge();
  }
}

// ── Top-level setup: ensure listeners are registered before any event fires ──

const seerrAPI = new SeerrAPI();

// Synchronous listener registration (guaranteed before worker considers itself ready)
// The URL and feature flags sync across devices; the API key stays local.
chrome.storage.onChanged.addListener((changes, namespace) => {
  const relevant = (namespace === 'sync' && changes.seerrUrl) ||
    (namespace === 'local' && (changes.seerrApiKey || changes.debugLogging));
  if (!relevant) return;
  seerrAPI.log('🔄 [Background] Settings changed, reloading...');
  seerrAPI.loadSettings()
    .then(() => seerrAPI.syncOverlayRegistration())
    .then(() => {
      seerrAPI.log('🔄 [Background] Settings reloaded. Current URL:', seerrAPI.baseUrl);
      seerrAPI.log('🔄 [Background] Settings reloaded. API Key set:', !!seerrAPI.apiKey);
    })
    .catch(err => console.error('🔄 [Background] Settings reload failed:', err));
});

// A revoked host permission must tear the overlay registration back down.
chrome.permissions?.onRemoved?.addListener(() => { seerrAPI.syncOverlayRegistration(); });
chrome.permissions?.onAdded?.addListener(() => { seerrAPI.syncOverlayRegistration(); });

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  settingsReady.then(() => seerrAPI.handleMessage(request, sender, sendResponse))
    .catch(error => sendResponse({ success: false, error: error.message }));
  return true; // Keep message channel open for async responses
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Extension installed — no auto-open. User discovers settings via popup.
  }
});

// Async init — runs migration and loads settings after listeners are registered
const settingsReady = (async () => {
  await seerrAPI.loadSettings();
  await seerrAPI.migrateStorage();
  await seerrAPI.loadSettings();
  await seerrAPI.syncOverlayRegistration();
})();

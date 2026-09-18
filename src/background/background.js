// Background service worker for Seerr integration
import '../shared/RatingsConfig.js';
import '../shared/MediaValidation.js';
import './SeerrMatching.js';
import './MediaStatus.js';
import './RtCache.js';
import './RottenTomatoes.js';
import './SeerrTransport.js';
import './PlexWatchlist.js';
const RatingsConfig = globalThis.RatingsConfig;
const MediaValidation = globalThis.MediaValidation;

// The Seerr server is self-hosted, so its origin is only known at runtime and
// cannot be a static content_scripts match. The overlay is registered against
// the saved origin instead, once the user grants that optional host permission.
const OVERLAY_SCRIPT_ID = 'seerr-overlay';
const OVERLAY_SCRIPT_FILES = {
  js: ['src/shared/RatingsModel.js', 'src/shared/RatingsConfig.js', 'src/content/OverlayCache.js', 'src/content/RatingsPresentation.js', 'src/content/SeerrSession.js', 'src/content/seerr-integration.js'],
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
    this.plexToken = null;
    this.debugLogging = false;
    this.mediaServerName = null;
    this.rtCache = new Map();
    this.rtPending = new Map();
    this.rtCacheReady = null;
    this.rtCacheFlushTimer = null;
    this.rtCacheFlushing = null;
    this.rtCacheGeneration = 0;
    this.rtTransportFailures = 0;
    this.rtInFlight = 0;
    this.rtWaiting = [];
    this.rtBackoffUntil = 0;
    this.cacheClearPending = null;
    this.settingsGeneration = 0;
    this.settingsLoadGeneration = 0;
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
    const generation = ++this.settingsLoadGeneration;
    try {
      const [synced, local] = await Promise.all([
        chrome.storage.sync.get(['seerrUrl']),
        chrome.storage.local.get(['seerrApiKey', 'plexToken', 'debugLogging', 'mediaServerName'])
      ]);
      if (generation !== this.settingsLoadGeneration) return;
      this.baseUrl = synced.seerrUrl;
      this.apiKey = local.seerrApiKey;
      this.plexToken = local.plexToken || null;
      this.debugLogging = local.debugLogging === true;
      this.updateIconBadge();
      // Manifest V3 evicts this worker after seconds of idle, so re-fetching the
      // media server on every restart left the first status of each session
      // labelled generically: a bare "Watch" rather than one naming the server.
      // The last answer for this server is used immediately and refreshed behind
      // it, so cosmetic metadata still never holds up messages or readiness.
      const remembered = local.mediaServerName;
      this.mediaServerName = remembered?.url === this.baseUrl ? remembered.name ?? null : null;
      this.mediaServerReady = this.loadMediaServerName();
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
    const generation = ++this.settingsGeneration;
    const baseUrl = this.baseUrl;
    // The remembered name is set by loadSettings and belongs to this baseUrl;
    // clearing it here would undo that on every restart.
    if (!baseUrl) {
      this.mediaServerName = null;
      return;
    }
    try {
      const url = `${baseUrl.replace(/\/$/, '')}/api/v1/settings/public`;
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(RatingsConfig.requestTimeoutMs),
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) return;
      const settings = await response.json();
      if (generation !== this.settingsGeneration) return;
      this.mediaServerName = MEDIA_SERVER_NAMES[settings?.mediaServerType] ?? null;
      await chrome.storage.local.set({ mediaServerName: { url: baseUrl, name: this.mediaServerName } });
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
          sendResponse({ success: true, data: { apiConfigured: !!(this.baseUrl && this.apiKey), serverUrl: this.baseUrl ?? null, plexConfigured: !!this.plexToken } });
          break;
        }

        case 'plexTestConnection': {
          // A throwaway client keeps the test from touching saved settings.
          const plexClient = new SeerrAPI();
          plexClient.plexToken = (request.data && request.data.plexToken) || this.plexToken;
          const plexResult = await plexClient.plexTestConnection(request.data || null);
          sendResponse({ success: true, data: plexResult });
          break;
        }

        case 'plexAddToWatchlist': {
          const plexWatchlistResult = await this.plexAddToWatchlist(request.data);
          sendResponse({ success: true, data: plexWatchlistResult });
          break;
        }

        case 'plexWatchlistState': {
          const plexStateResult = await this.plexWatchlistState(request.data);
          sendResponse({ success: true, data: plexStateResult });
          break;
        }

        case 'addToWatchlist': {
          const watchlistResult = await this.addToWatchlist(request.data);
          sendResponse({ success: true, data: watchlistResult });
          break;
        }

        case 'clearRatingsCache': {
          await this.clearRatingsCache();
          sendResponse({ success: true });
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
    mediaData = MediaValidation.media(mediaData);
    if (!this.baseUrl || !this.apiKey) {
      throw new Error('Seerr server URL and API key are required. Please configure them in the extension options.');
    }

    this.log('🎬 [Background] Requesting media:', mediaData);

    // Use TMDB ID directly if provided — skip search entirely
    let tmdbId = mediaData.tmdbId;
    if (tmdbId && !isNaN(tmdbId)) {
      this.log('✅ [Background] Using provided TMDB ID:', tmdbId);
    } else {
      const bestMatch = await this.resolveMediaMatch(mediaData);
      if (!bestMatch) {
        throw new Error(`No unambiguous match for "${mediaData.title}". Choose this title in Seerr before requesting.`);
      }
      tmdbId = MediaValidation.tmdbId(bestMatch.id);
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
    mediaData = MediaValidation.media(mediaData);
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
      const knownTmdbId = mediaData.tmdbId;
      if (Number.isInteger(knownTmdbId) && knownTmdbId > 0) {
        this.log('📊 [Background] Using provided TMDB ID, skipping search:', knownTmdbId);
        const details = await this.getMediaDetails(knownTmdbId, mediaData.mediaType);
        return this.formatMediaStatus(details, mediaData.mediaType);
      }

      const bestMatch = await this.resolveMediaMatch(mediaData);
      if (!bestMatch) {
        this.log('📊 [Background] No unambiguous match; asking the user to choose in Seerr');
        return {
          status: 'unmatched',
          message: 'No unambiguous match. Choose this title in Seerr.',
          buttonText: 'Choose in Seerr',
          buttonClass: 'request',
          action: 'choose'
        };
      }

      const tmdbId = MediaValidation.tmdbId(bestMatch.id);
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
        message: error.message || 'Status lookup failed',
        buttonText: 'Retry status',
        buttonClass: 'error',
        action: 'retryStatus'
      };
    }
  }

  async getMediaDetails(tmdbId, mediaType) {
    tmdbId = MediaValidation.tmdbId(tmdbId);
    mediaType = MediaValidation.mediaType(mediaType);
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
      throw error;
    }
  }

  async searchRequests(tmdbId, mediaType) {
    try {
      this.log(`📊 [Background] Searching requests for TMDB ID ${tmdbId} (${mediaType})`);
      // Requests are newest-first and unpaginated reads stop at 100, so a
      // long history hides older requests past the first page. Page until
      // a match, a short page, or a sane cap — never unbounded.
      const PAGE_SIZE = 100;
      const MAX_PAGES = 10;
      for (let page = 0; page < MAX_PAGES; page++) {
        const response = await this.makeAPIRequest('GET', `/api/v1/request?take=${PAGE_SIZE}&skip=${page * PAGE_SIZE}`);
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

        // A full page may hide the match on the next one; a short page ends it.
        if (requests.length < PAGE_SIZE) break;
      }

      this.log('📊 [Background] ❌ No matching request found');
      return null;
    } catch (error) {
      console.error('📊 [Background] Could not search requests:', error);
      throw error;
    }
  }

  async debugAPI(tmdbId, mediaType) {
    tmdbId = MediaValidation.tmdbId(tmdbId);
    mediaType = MediaValidation.mediaType(mediaType);
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
    data = MediaValidation.media(data, { requireId: true });
    if (!this.baseUrl || !this.apiKey) {
      throw new Error('Seerr server URL and API key are required');
    }
    // Seerr validates this body with a zod schema that requires tmdbId and
    // mediaType; see server/interfaces/api/watchlistCreate.ts. We were sending
    // mediaId, which that schema has no field for, so every add was rejected.
    // title is optional and is what Seerr's own front end sends.
    const tmdbId = data.tmdbId;
    const response = await this.makeAPIRequest('POST', '/api/v1/watchlist', {
      tmdbId,
      mediaType: data.mediaType,
      ...(data.title ? { title: String(data.title) } : {})
    });
    return response;
  }

  updateSettings(settings) {
    this.baseUrl = settings.seerrUrl;
    this.apiKey = settings.seerrApiKey;
    if (settings.plexToken !== undefined) this.plexToken = settings.plexToken || null;
    this.updateIconBadge();
  }
}

// ── Top-level setup: ensure listeners are registered before any event fires ──

Object.assign(SeerrAPI.prototype, globalThis.SeerrMatching, globalThis.MediaStatus, globalThis.RtCache, globalThis.RottenTomatoes, globalThis.SeerrTransport, globalThis.PlexWatchlist);

const seerrAPI = new SeerrAPI();
let initializing = true;

// Synchronous listener registration (guaranteed before worker considers itself ready)
// The URL and feature flags sync across devices; the API key stays local.
chrome.storage.onChanged.addListener((changes, namespace) => {
  const relevant = (namespace === 'sync' && changes.seerrUrl) ||
    (namespace === 'local' && (changes.seerrApiKey || changes.plexToken || changes.debugLogging));
  if (!relevant || initializing) return;
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
  await seerrAPI.migrateStorage();
  await seerrAPI.loadSettings();
  await seerrAPI.syncOverlayRegistration();
})().finally(() => { initializing = false; });

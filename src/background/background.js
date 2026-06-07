// Background service worker for Seerr integration

class SeerrAPI {
  constructor() {
    this.baseUrl = null;
    this.apiKey = null;
  }

  async migrateStorage() {
    try {
      const old = await chrome.storage.sync.get(['jellyseerrUrl', 'jellyseerrApiKey']);
      const updates = {};
      const removals = [];

      if (old.jellyseerrUrl) {
        updates.seerrUrl = old.jellyseerrUrl;
        removals.push('jellyseerrUrl');
      }
      if (old.jellyseerrApiKey) {
        updates.seerrApiKey = old.jellyseerrApiKey;
        removals.push('jellyseerrApiKey');
      }

      if (removals.length > 0) {
        await chrome.storage.sync.set(updates);
        await chrome.storage.sync.remove(removals);
        console.log('✅ [Seerr] Storage migration complete');
      }
    } catch (error) {
      console.error('❌ [Seerr] Storage migration failed, continuing:', error);
    }
  }

  async loadSettings() {
    try {
      const settings = await chrome.storage.sync.get(['seerrUrl', 'seerrApiKey']);
      this.baseUrl = settings.seerrUrl;
      this.apiKey = settings.seerrApiKey;
      this.updateIconBadge();
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

  async handleMessage(request, sender, sendResponse) {
    try {
      switch (request.action) {
        case 'requestMedia':
          const result = await this.requestMedia(request.data);
          sendResponse({ success: true, data: result });
          break;

        case 'testConnection':
          const connectionResult = await this.testConnection();
          sendResponse({ success: true, data: connectionResult });
          break;

        case 'searchMedia':
          const searchResult = await this.searchMedia(request.query, request.mediaType);
          sendResponse({ success: true, data: searchResult });
          break;

        case 'debugSearch':
          const debugResult = await this.debugSearch(request.title, request.mediaType);
          sendResponse({ success: true, data: debugResult });
          break;

        case 'ping':
          sendResponse({ success: true, data: 'pong' });
          break;

        case 'debugAPI':
          const apiDebugResult = await this.debugAPI(request.tmdbId, request.mediaType);
          sendResponse({ success: true, data: apiDebugResult });
          break;

        case 'getMediaStatus':
          const statusResult = await this.getMediaStatus(request.data);
          sendResponse({ success: true, data: statusResult });
          break;

        case 'reloadSettings':
          await this.loadSettings();
          sendResponse({ success: true, data: 'Settings reloaded' });
          break;

        case 'addToWatchlist':
          const watchlistResult = await this.addToWatchlist(request.data);
          sendResponse({ success: true, data: watchlistResult });
          break;

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

    console.log('🎬 [Background] Requesting media:', mediaData);

    // Use TMDB ID directly if provided — skip search entirely
    let tmdbId = mediaData.tmdbId ? parseInt(mediaData.tmdbId) : null;
    if (tmdbId && !isNaN(tmdbId)) {
      console.log('✅ [Background] Using provided TMDB ID:', tmdbId);
    } else {
      // No TMDB ID provided — do a title search
      const searchTerms = this.generateSearchTerms(mediaData.title);
      console.log('🔍 [Background] Generated search terms:', searchTerms);

      let searchResults = [];
      let bestMatch = null;

      for (const searchTerm of searchTerms) {
        try {
          console.log('🔍 [Background] Searching for:', searchTerm, 'type:', mediaData.mediaType);
          searchResults = await this.searchMedia(searchTerm, mediaData.mediaType);
          console.log('🔍 [Background] Search results for "' + searchTerm + '":', searchResults.length, 'items');

          bestMatch = this.findBestMatch(searchResults, { ...mediaData, title: searchTerm });
          console.log('🎯 [Background] Best match for "' + searchTerm + '":', bestMatch);

          if (bestMatch) {
            tmdbId = parseInt(bestMatch.id);
            console.log('✅ [Background] Using TMDB ID:', tmdbId, 'from search term:', searchTerm);
            break;
          }
        } catch (searchError) {
          console.warn('⚠️ [Background] Search failed for "' + searchTerm + '":', searchError);
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

    console.log('📡 [Background] Sending request to Seerr:', requestData);
    const response = await this.makeAPIRequest('POST', '/api/v1/request', requestData);
    console.log('✅ [Background] Request successful:', response);

    return {
      id: response.id,
      mediaType: response.type,
      status: response.status,
      title: mediaData.title
    };
  }

  generateSearchTerms(originalTitle) {
    console.log('🔍 [Background] generateSearchTerms called with:', originalTitle);
    const terms = [originalTitle];

    const variations = [
      originalTitle.replace(/Se7en/gi, 'Seven'),
      originalTitle.replace(/Seven/gi, 'Se7en'),
      originalTitle.replace(/2/g, 'Two'),
      originalTitle.replace(/Two/gi, '2'),
      originalTitle.replace(/3/g, 'Three'),
      originalTitle.replace(/Three/gi, '3'),
      originalTitle.replace(/4/g, 'Four'),
      originalTitle.replace(/Four/gi, '4'),
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

    console.log('🔍 [Background] Initial variations generated:', variations.length);

    variations.forEach((variation, index) => {
      const cleaned = variation.trim();
      console.log(`🔍 [Background] Variation ${index}: "${variation}" -> cleaned: "${cleaned}"`);
      if (cleaned && cleaned !== originalTitle && !terms.includes(cleaned)) {
        terms.push(cleaned);
        console.log('🔍 [Background] Added variation:', cleaned);
      }
    });

    console.log('🔍 [Background] Final search terms:', terms);
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
    console.log('🔍 [Background] Debug search for:', title, 'type:', mediaType);

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
        console.log(`🔍 [Background] Debug: "${searchTerm}" -> ${searchResults.length} results`);
      } catch (error) {
        results.push({ searchTerm, error: error.message });
      }
    }

    return { searchTerms, results };
  }

  async getMediaStatus(mediaData) {
    console.log('📊 [Background] Getting media status for:', mediaData);
    console.log('📊 [Background] API Config - baseUrl:', this.baseUrl, 'apiKey:', this.apiKey ? '[SET]' : '[NOT SET]');

    if (!this.baseUrl || !this.apiKey) {
      console.error('📊 [Background] Missing API configuration');
      throw new Error('Seerr server URL and API key are required');
    }

    try {
      console.log('📊 [Background] Starting search for title:', mediaData.title, 'type:', mediaData.mediaType);
      const searchTerms = this.generateSearchTerms(mediaData.title);
      console.log('📊 [Background] Generated search terms:', searchTerms);
      let bestMatch = null;
      let searchResults = [];

      for (let i = 0; i < searchTerms.length; i++) {
        const searchTerm = searchTerms[i];
        try {
          console.log(`📊 [Background] Searching term ${i + 1}/${searchTerms.length}: "${searchTerm}"`);
          searchResults = await this.searchMedia(searchTerm, mediaData.mediaType);
          console.log(`📊 [Background] Search results for "${searchTerm}":`, searchResults.length, 'items');

          if (searchResults.length > 0) {
            console.log('📊 [Background] First few results:', searchResults.slice(0, 3).map(r => ({
              id: r.id, title: r.title || r.name, year: r.releaseDate || r.firstAirDate, mediaType: r.mediaType
            })));
          }

          bestMatch = this.findBestMatch(searchResults, { ...mediaData, title: searchTerm });
          console.log(`📊 [Background] Best match for "${searchTerm}":`, bestMatch ? {
            id: bestMatch.id, title: bestMatch.title || bestMatch.name, mediaType: bestMatch.mediaType
          } : 'none');

          if (bestMatch) {
            console.log('📊 [Background] ✅ Found best match, breaking search loop');
            break;
          }
        } catch (error) {
          console.warn(`📊 [Background] Search failed for "${searchTerm}":`, error.message);
          continue;
        }
      }

      if (!bestMatch) {
        console.log('📊 [Background] ❌ No media found after trying all search terms');
        console.log('📊 [Background] Returning available status (not in database)');
        return {
          status: 'available',
          message: 'Ready to request',
          buttonText: 'Request on Seerr',
          buttonClass: 'request'
        };
      }

      const tmdbId = parseInt(bestMatch.id);
      console.log('📊 [Background] ✅ Found media with TMDB ID:', tmdbId);

      console.log('📊 [Background] Fetching detailed status...');
      const mediaDetails = await this.getMediaDetails(tmdbId, mediaData.mediaType);
      console.log('📊 [Background] Media details response:', mediaDetails);

      const formattedStatus = this.formatMediaStatus(mediaDetails, mediaData.mediaType);
      console.log('📊 [Background] Final formatted status:', formattedStatus);

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
    console.log(`📊 [Background] Getting media details for TMDB ID ${tmdbId} (${mediaType})`);

    console.log('📊 [Background] Checking requests first for accurate status...');
    const requestResult = await this.searchRequests(tmdbId, mediaType);

    if (requestResult) {
      console.log('📊 [Background] Found in requests, using request status');
      return requestResult;
    }

    try {
      const endpoint = mediaType === 'tv' ? `/api/v1/tv/${tmdbId}` : `/api/v1/movie/${tmdbId}`;
      console.log(`📊 [Background] Not in requests, trying direct lookup: ${endpoint}`);

      const response = await this.makeAPIRequest('GET', endpoint);
      console.log('📊 [Background] Direct lookup response:', response);

      return response;

    } catch (error) {
      console.log(`📊 [Background] Direct lookup failed (${error.message})`);
      return null;
    }
  }

  async searchRequests(tmdbId, mediaType) {
    try {
      console.log(`📊 [Background] Searching requests for TMDB ID ${tmdbId} (${mediaType})`);
      const response = await this.makeAPIRequest('GET', '/api/v1/request?take=100&skip=0');
      console.log('📊 [Background] Requests API response:', response);

      const requests = response.results || response || [];
      console.log(`📊 [Background] Found ${requests.length} total requests`);

      if (requests.length > 0) {
        console.log('📊 [Background] Sample requests:', requests.slice(0, 3).map(r => ({
          id: r.id, type: r.type, status: r.status,
          mediaId: r.media?.tmdbId || r.media?.id,
          title: r.media?.title || r.media?.name
        })));
      }

      const matchingRequest = requests.find(request => {
        const requestMediaType = request.type === 'movie' ? 'movie' : 'tv';
        const matchesType = requestMediaType === mediaType;
        const matchesTmdbId = request.media?.tmdbId === tmdbId || request.media?.id === tmdbId;

        console.log(`📊 [Background] Checking request:`, {
          requestId: request.id, requestType: requestMediaType, matchesType,
          mediaId: request.media?.tmdbId || request.media?.id, matchesTmdbId,
          title: request.media?.title || request.media?.name
        });

        return matchesType && matchesTmdbId;
      });

      if (matchingRequest) {
        console.log('📊 [Background] ✅ Found matching request:', {
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

      console.log('📊 [Background] ❌ No matching request found');
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

    console.log('📊 [Background] Raw mediaDetails for status formatting:');
    console.log('📊 [Background] mediaDetails.status:', mediaDetails.status);
    console.log('📊 [Background] mediaDetails.media:', mediaDetails.media ? {
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
    console.log('📊 [Background] mediaDetails.mediaInfo:', mediaDetails.mediaInfo ? {
      status: mediaDetails.mediaInfo.status,
      inProduction: mediaDetails.mediaInfo.inProduction,
      seasons: mediaDetails.mediaInfo.seasons
    } : null);
    console.log('📊 [Background] mediaDetails.requests:', mediaDetails.requests ? mediaDetails.requests.length + ' requests' : null);

    console.log('📊 [Background] Full object keys for monitoring detection:', Object.keys(mediaDetails));
    if (mediaDetails.seasons) {
      console.log('📊 [Background] Seasons data available:', mediaDetails.seasons.length);
    }

    let status = null;
    let mediaUrl = null;
    let serviceUrl = null;

    if (mediaDetails.status !== undefined && mediaDetails.media) {
      status = mediaDetails.status;
      mediaUrl = mediaDetails.media.mediaUrl;
      serviceUrl = mediaDetails.media.serviceUrl;
      console.log('📊 [Background] Found REQUEST object with status:', status);
      console.log('📊 [Background] Media has status', mediaDetails.media.status, 'but using request status', status);
    } else if (mediaDetails.requests && mediaDetails.requests.length > 0) {
      const latestRequest = mediaDetails.requests[0];
      status = latestRequest.status;
      if (latestRequest.media) {
        mediaUrl = latestRequest.media.mediaUrl;
        serviceUrl = latestRequest.media.serviceUrl;
      }
      console.log('📊 [Background] Found status in requests array:', status);
    } else if (mediaDetails.mediaInfo && mediaDetails.mediaInfo.status !== undefined) {
      status = mediaDetails.mediaInfo.status;
      mediaUrl = mediaDetails.mediaInfo.mediaUrl;
      serviceUrl = mediaDetails.mediaInfo.serviceUrl;
      console.log('📊 [Background] Found status in mediaInfo:', status);
    } else if (mediaDetails.media && mediaDetails.media.status !== undefined) {
      status = mediaDetails.media.status;
      mediaUrl = mediaDetails.media.mediaUrl;
      serviceUrl = mediaDetails.media.serviceUrl;
      console.log('📊 [Background] Found status in media object:', status);
    } else if (mediaDetails.status !== undefined) {
      status = mediaDetails.status;
      console.log('📊 [Background] Found direct status:', status);
    }

    console.log('📊 [Background] Final extracted status:', status);
    console.log('📊 [Background] Media URLs - mediaUrl:', mediaUrl, 'serviceUrl:', serviceUrl);

    if (status === null || status === undefined) {
      console.log('📊 [Background] No status found, returning available for request');
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

    console.log('📊 [Background] Mapping status:', status, '(type:', typeof status, ') to UI format');
    console.log('📊 [Background] Raw status value for debugging:', JSON.stringify(status));

    const numericStatus = parseInt(status);
    if (isNaN(numericStatus)) {
      console.warn('📊 [Background] Unparseable status value:', status, 'treating as unknown');
      result.status = 'unknown';
      result.message = 'Status unavailable';
      result.buttonText = 'Request on Seerr';
      result.buttonClass = 'request';
      console.log('📊 [Background] Formatted status:', result);
      return result;
    }
    console.log('📊 [Background] Numeric status:', numericStatus);

    switch (numericStatus) {
      case 1:
        result.status = 'unknown';
        result.message = 'Status unclear';
        result.buttonText = 'Request on Seerr';
        result.buttonClass = 'request';
        break;

      case 2:
        result.status = 'pending';
        result.message = 'Request monitoring';
        result.buttonText = 'Request Pending';
        result.buttonClass = 'pending';
        break;

      case 3:
        result.status = 'downloading';
        result.message = 'Processing download (detailed progress not available)';
        result.buttonText = 'Processing...';
        result.buttonClass = 'downloading';

        console.log('🔍 [DEBUG] DOWNLOADING STATUS DETECTED - Investigating available data');
        console.log('🔍 [DEBUG] Full mediaDetails object:', JSON.stringify(mediaDetails, null, 2));

        const progressFields = ['progress', 'percentage', 'downloadProgress', 'completion', 'percent'];
        const speedFields = ['speed', 'downloadSpeed', 'rate', 'transferRate'];
        const etaFields = ['eta', 'timeRemaining', 'estimatedCompletion', 'remainingTime'];
        const clientFields = ['downloadClient', 'downloader', 'client'];

        progressFields.forEach(field => {
          if (mediaDetails[field] !== undefined) {
            console.log(`🔍 [DEBUG] Found progress field '${field}':`, mediaDetails[field]);
            result.progress = mediaDetails[field];
          }
        });

        speedFields.forEach(field => {
          if (mediaDetails[field] !== undefined) {
            console.log(`🔍 [DEBUG] Found speed field '${field}':`, mediaDetails[field]);
            result.downloadSpeed = mediaDetails[field];
          }
        });

        etaFields.forEach(field => {
          if (mediaDetails[field] !== undefined) {
            console.log(`🔍 [DEBUG] Found ETA field '${field}':`, mediaDetails[field]);
            result.eta = mediaDetails[field];
          }
        });

        clientFields.forEach(field => {
          if (mediaDetails[field] !== undefined) {
            console.log(`🔍 [DEBUG] Found client field '${field}':`, mediaDetails[field]);
            result.downloadClient = mediaDetails[field];
          }
        });

        if (mediaDetails.media) {
          console.log('🔍 [DEBUG] Checking media sub-object for progress data...');
          [...progressFields, ...speedFields, ...etaFields, ...clientFields].forEach(field => {
            if (mediaDetails.media[field] !== undefined) {
              console.log(`🔍 [DEBUG] Found media.${field}:`, mediaDetails.media[field]);
            }
          });
        }

        if (result.progress !== undefined) {
          result.message = `Download in progress (${result.progress}%)`;
          result.buttonText = `Downloading ${result.progress}%`;
        }

        break;

      case 4:
        result.status = 'partial';
        result.message = 'Partially ready';
        result.buttonText = 'Partially Available';
        result.buttonClass = 'partial';
        if (mediaUrl) {
          result.message = 'Available on Jellyfin';
          result.watchUrl = mediaUrl;
          result.buttonText = 'Watch on Jellyfin';
          result.buttonClass = 'watch';
        }
        break;

      case 5:
        result.status = 'available_watch';
        result.message = 'Available on Jellyfin';
        result.buttonText = 'Available';
        result.buttonClass = 'available';
        if (mediaUrl) {
          result.watchUrl = mediaUrl;
          result.buttonText = 'Watch on Jellyfin';
          result.buttonClass = 'watch';
        }
        break;

      default:
        console.log('📊 [Background] Unknown status value:', status, 'treating as available');
        result.status = 'available';
        result.message = 'Ready to request';
        result.buttonText = 'Request on Seerr';
        result.buttonClass = 'request';
        break;
    }

    const monitoringInfo = this.detectMonitoringStatus(mediaDetails, mediaType);
    if (monitoringInfo) {
      result.monitoring = monitoringInfo;
      console.log('📊 [Background] Monitoring info:', monitoringInfo);
    }

    console.log('📊 [Background] Formatted status:', result);
    return result;
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

  async debugAPI(tmdbId, mediaType) {
    console.log(`🛠️ [Background] Debugging API endpoints for TMDB ID ${tmdbId} (${mediaType})`);
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
          console.log(`🛠️ [Background] Testing endpoint: ${endpoint}`);
          const response = await this.makeAPIRequest('GET', endpoint);
          results[endpoint] = {
            success: true,
            dataType: Array.isArray(response) ? 'array' : typeof response,
            hasResults: response.results ? response.results.length : 'no results field',
            keys: Object.keys(response).slice(0, 10),
            sample: endpoint.includes('request') ? (response.results || response)?.slice(0, 2) : response
          };
          console.log(`🛠️ [Background] ${endpoint} - SUCCESS:`, results[endpoint]);
        } catch (error) {
          results[endpoint] = { success: false, error: error.message };
          console.log(`🛠️ [Background] ${endpoint} - FAILED:`, error.message);
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

      return await response.json();
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
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync' && (changes.seerrUrl || changes.seerrApiKey)) {
    console.log('🔄 [Background] Settings changed, reloading...');
    seerrAPI.loadSettings().then(() => {
      console.log('🔄 [Background] Settings reloaded. Current URL:', seerrAPI.baseUrl);
      console.log('🔄 [Background] Settings reloaded. API Key set:', !!seerrAPI.apiKey);
    }).catch(err => console.error('🔄 [Background] Settings reload failed:', err));
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  seerrAPI.handleMessage(request, sender, sendResponse);
  return true; // Keep message channel open for async responses
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Extension installed — no auto-open. User discovers settings via popup.
  }
});

// Async init — runs migration and loads settings after listeners are registered
(async () => {
  await seerrAPI.loadSettings();
  await seerrAPI.migrateStorage();
  await seerrAPI.loadSettings();
})();

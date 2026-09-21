// Shared Seerr API Client
// Handles all communication with background script and Seerr API

// An explicit error reply from the worker, not a broken message channel.
// Read retries are reserved for messaging failures. Writes are never retried
// automatically, regardless of whether an error reply arrives.
class SeerrResponseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SeerrResponseError';
    this.definite = true;
  }
}

class SeerrClient {
  constructor(options = {}) {
    this.debug = options.debug || false;
    // ?? not ||, so a caller's 0 survives. At least one attempt, or the
    // read retry loop would never run and getMediaStatus would return undefined.
    this.retryAttempts = Math.max(1, options.retryAttempts ?? 3);
    this.retryDelay = Math.max(0, options.retryDelay ?? 1000);
    this.siteName = options.siteName || 'UNKNOWN';
  }

  log(...args) {
    if (this.debug) console.log(`🔗 [${this.siteName}]`, ...args);
  }

  warn(...args) {
    if (this.debug) console.warn(`🚨 [${this.siteName}]`, ...args);
  }

  error(...args) {
    console.error(`🚨 [${this.siteName}]`, ...args);
  }

  async sendMessage(message) {
    return await chrome.runtime.sendMessage(message);
  }

  /**
   * Test connection to extension background script
   */
  async testExtensionConnection() {
    try {
      await this.sendMessage({ action: 'ping' });
      this.log('Extension connection test successful');
      return true;
    } catch (err) {
      this.log('Extension connection test failed:', err.message);
      return false;
    }
  }

  /**
   * Test connection to Seerr server
   */
  async testServerConnection() {
    try {
      const response = await this.sendMessage({ action: 'testConnection' });
      this.log('Server connection test response:', response);
      if (response && response.success) {
        this.log('Server connection test SUCCESSFUL');
        return true;
      }
      this.log('Server connection test FAILED');
      return false;
    } catch (err) {
      this.log('Server connection test failed:', err.message);
      return false;
    }
  }

  /**
   * Get media status from Seerr
   */
  async getMediaStatus(mediaData) {
    // Pre-flight check — only run once, not per retry
    const extensionOk = await this.testExtensionConnection();
    if (!extensionOk) throw new Error('Extension background script not responding');

    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        const response = await this.sendMessage({
          action: 'getMediaStatus',
          data: mediaData
        });

        if (response && response.success) {
          return response.data;
        }
        if (response) throw new SeerrResponseError(response.error || 'Status unavailable');
        throw new Error('No response received');

      } catch (err) {
        if (err.definite || attempt === this.retryAttempts) throw err;
        this.warn(`getMediaStatus attempt ${attempt} failed, retrying...`);
        await new Promise(r => setTimeout(r, this.retryDelay));
      }
    }
  }

  /**
   * Request media on Seerr
   */
  async requestMedia(mediaData) {
    // A failed ping is safe: no media write has been sent yet.
    const extensionOk = await this.testExtensionConnection();
    if (!extensionOk) {
      throw new Error('Could not connect to extension background script. Please reload the extension and try again.');
    }

    // A lost reply is an unknown outcome, not proof that the POST failed.
    // Without server-side idempotency, never automatically resend a write.
    let response;
    try {
      response = await this.sendMessage({ action: 'requestMedia', data: mediaData });
    } catch (error) {
      throw new Error(`Request outcome unknown. Check Seerr before requesting again. (${error.message})`);
    }
    if (!response) throw new Error('Request outcome unknown. Check Seerr before requesting again.');
    if (!response.success) throw new SeerrResponseError(response.error || 'Request failed');
    return response.data;
  }

  /**
   * Debug search functionality
   */
  async debugSearch(title, mediaType = 'movie') {
    try {
      const result = await this.sendMessage({
        action: 'debugSearch',
        title,
        mediaType
      });
      this.log('Search debug result:', result);
      return result;
    } catch (err) {
      this.error('Failed to debug search:', err);
      return err;
    }
  }

  /**
   * Debug API functionality
   */
  async debugAPI(tmdbId, mediaType = 'tv') {
    try {
      this.log('Running API debug...');
      const result = await this.sendMessage({
        action: 'debugAPI',
        tmdbId: tmdbId || 1438,
        mediaType
      });

      console.log('API Debug Results:', result);

      if (result.data) {
        Object.entries(result.data).forEach(([endpoint, r]) => {
          if (r.success) {
            console.log('✅', endpoint, '- Works!');
            if (endpoint.includes('request') && r.sample) {
              console.log('📋 Sample requests:', r.sample);
            }
          } else {
            console.log('❌', endpoint, '- Failed:', r.error);
          }
        });
      }

      return result;
    } catch (err) {
      this.error('API debug failed:', err);
      return null;
    }
  }

  async addToWatchlist(mediaData) {
    const response = await this.sendMessage({
      action: 'addToWatchlist',
      data: { mediaType: mediaData.mediaType, tmdbId: mediaData.tmdbId, title: mediaData.title, year: mediaData.year ?? null }
    });
    if (response && response.success) {
      return response.data;
    }
    throw new Error(response ? response.error : 'No response received');
  }

  async plexAddToWatchlist(mediaData) {
    const response = await this.sendMessage({
      action: 'plexAddToWatchlist',
      data: {
        mediaType: mediaData.mediaType,
        tmdbId: mediaData.tmdbId,
        title: mediaData.title,
        year: mediaData.year ?? null
      }
    });
    if (response && response.success) return response.data;
    throw new Error(response ? response.error : 'No response received');
  }

  // Read-only state for button labels. Never throws: unknown keeps the Add
  // button, which reports already-on-watchlist if it turns out to be there.
  async plexWatchlistState(mediaData) {
    try {
      const response = await this.sendMessage({
        action: 'plexWatchlistState',
        data: {
          mediaType: mediaData.mediaType,
          tmdbId: mediaData.tmdbId,
          title: mediaData.title,
          year: mediaData.year ?? null
        }
      });
      if (response && response.success) return response.data;
    } catch (_) {}
    return { onWatchlist: false, unknown: true };
  }

  async plexTestConnection(plexToken) {
    const response = await this.sendMessage({ action: 'plexTestConnection', data: { plexToken } });
    if (response && response.success) return response.data;
    throw new Error(response ? response.error : 'No response received');
  }
}

// Export for use in content scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SeerrClient;
  module.exports.SeerrResponseError = SeerrResponseError;
} else if (typeof window !== 'undefined') {
  window.SeerrClient = SeerrClient;
}

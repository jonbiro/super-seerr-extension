// Shared Seerr API Client
// Handles all communication with background script and Seerr API

class SeerrClient {
  constructor(options = {}) {
    this.debug = options.debug || false;
    this.retryAttempts = options.retryAttempts || 3;
    this.retryDelay = options.retryDelay || 1000;
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
    // Pre-flight checks — only run once, not per retry
    const extensionOk = await this.testExtensionConnection();
    if (!extensionOk) throw new Error('Extension background script not responding');

    const serverOk = await this.testServerConnection();
    this.log('Server connection test result:', serverOk);
    if (!serverOk) {
      throw new Error('Cannot connect to Seerr server. Please check your server URL and API key in extension settings.');
    }

    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        const response = await this.sendMessage({
          action: 'getMediaStatus',
          data: mediaData
        });

        if (response && response.success) {
          return response.data;
        }
        throw new Error(response?.error || 'No response received');

      } catch (err) {
        if (attempt === this.retryAttempts) throw err;
        this.warn(`getMediaStatus attempt ${attempt} failed, retrying...`);
        await new Promise(r => setTimeout(r, this.retryDelay));
      }
    }
  }

  /**
   * Request media on Seerr
   */
  async requestMedia(mediaData) {
    // Pre-flight check — only run once, not per retry
    const extensionOk = await this.testExtensionConnection();
    if (!extensionOk) {
      throw new Error('Could not connect to extension background script. Please reload the extension and try again.');
    }

    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        this.log(`Attempting to send message (attempt ${attempt}/${this.retryAttempts})`);

        const response = await this.sendMessage({
          action: 'requestMedia',
          data: mediaData
        });

        if (response && response.success) {
          this.log('Request successful:', response.data);
          return response.data;
        }

        const errorMsg = response ? response.error : 'Unknown error';
        this.error('Request failed:', errorMsg);
        throw new Error(errorMsg);

      } catch (err) {
        this.error(`Error on attempt ${attempt}:`, err);
        if (attempt === this.retryAttempts) {
          throw err;
        }
        this.warn(`Retrying in ${this.retryDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, this.retryDelay));
      }
    }
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
      data: { mediaType: mediaData.mediaType, tmdbId: mediaData.tmdbId }
    });
    if (response && response.success) {
      return response.data;
    }
    throw new Error(response ? response.error : 'No response received');
  }
}

// Export for use in content scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SeerrClient;
} else if (typeof window !== 'undefined') {
  window.SeerrClient = SeerrClient;
}

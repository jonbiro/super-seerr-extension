// Rotten Tomatoes Integration for Seerr
// Uses shared library architecture with flyout UI and Rotten Tomatoes' signature red theme

console.log('🍅 [Rotten Tomatoes] Integration script loaded!', window.location.href);

class RottenTomatoesIntegration extends BaseIntegration {
  constructor() {
    super('Rotten Tomatoes', {
      debug: false, // Set to true for debugging
      uiTheme: 'flyout', // Use flyout interface
      retryDelay: 2000,
      retryAttempts: 3
    });

    this.init();
  }

  /**
   * Extract media data from Rotten Tomatoes page
   * @returns {Object|null} Media data object or null
   */
  async extractMediaData() {
    this.log('Extracting media data from Rotten Tomatoes page...');

    // Determine media type from URL
    const url = window.location.pathname;
    let mediaType = 'movie';
    let urlMatch = null;

    // Check for movie pages
    if (url.includes('/m/')) {
      mediaType = 'movie';
      urlMatch = url.match(/\/m\/([^\/]+)/);
    }
    // Check for TV show pages
    else if (url.includes('/tv/')) {
      mediaType = 'tv';
      urlMatch = url.match(/\/tv\/([^\/]+)/);
    }
    else {
      this.log('URL does not match movie or TV pattern:', url);
      return null;
    }

    if (!urlMatch) {
      this.log('Could not extract media slug from URL:', url);
      return null;
    }

    this.log(`Detected ${mediaType} page from URL:`, urlMatch[1]);

    // Extract title - Rotten Tomatoes has various title structures
    const titleSelectors = [
      'h1[data-qa="score-panel-movie-title"]', // Main movie title
      'h1[data-qa="score-panel-series-title"]', // Main TV series title
      'h1.scoreboard__title', // Scoreboard title
      '.mop-ratings-wrap__title h1', // MOP ratings title
      'h1.title', // Generic title
      '.movie_info h1', // Movie info title
      'h1[data-testid="scorePanel-title"]', // Score panel title
      'h1[data-testid="title"]', // Test ID title
      '.title-wrap h1', // Title wrap
      'h1', // Fallback to any h1
      '.titleSection h1' // Title section
    ];

    const title = this.extractor.extractTitle(titleSelectors, {
      cleanupPatterns: [
        /\s*\(\d{4}\)\s*$/, // Remove year in parentheses
        /\s*\d{4}\s*$/, // Remove trailing year
        /\s*-\s*Rotten Tomatoes\s*$/, // Remove Rotten Tomatoes suffix
        /\s*Reviews.*$/, // Remove Reviews and everything after
        /\s*Season.*$/, // Remove Season info
      ]
    });

    if (!title) {
      this.log('No title found');
      return null;
    }

    // Extract year - RT shows release dates in various places
    const yearSelectors = [
      '.scoreboard__info', // Scoreboard info section
      '.mop-ratings-wrap__info', // MOP ratings info
      '[data-testid="scorePanel-info"]', // Score panel info
      '.movie_info .meta-value', // Movie info meta value
      '[data-qa="movie-info-item"]', // Movie info item
      '.info .meta-row .meta-value', // Info meta row
      '.release-date', // Direct release date
      'time[datetime]', // Time element
      '.year', // Direct year class
      '.movie-details .meta-value', // Movie details meta value
      '.info-item .value', // Info item value
      '.media-body .info', // Media body info
      '.score-panel .info' // Score panel info
    ];

    const year = this.extractor.extractYear(yearSelectors, {
      fallback: true,
      multiElementSelector: '.scoreboard__info, .mop-ratings-wrap__info' // Check multiple info sections
    });

    // Try to find IMDb links - RT often links to IMDb
    const imdbSelectors = [
      'a[href*="imdb.com/title/"]',
      '.movie-details a[href*="imdb"]',
      '.external-links a[href*="imdb"]',
      '.social-links a[href*="imdb"]',
      'a[data-qa="imdb-link"]'
    ];

    const imdbId = this.extractor.extractImdbId(imdbSelectors);

    // Extract poster - RT has prominent poster images
    const posterSelectors = [
      '.posterImage img', // Poster image
      '.movie-poster img', // Movie poster
      'img[data-qa="poster"]', // Poster with data-qa
      '.poster img', // Generic poster
      '.media-body img', // Media body image
      '.movie_info img', // Movie info image
      'img[src*="poster"]' // Image with poster in src
    ];

    const posterUrl = this.extractor.extractPosterUrl(posterSelectors);

    // Extract overview/synopsis - RT has various synopsis sections
    const overviewSelectors = [
      '.movie_synopsis', // Movie synopsis
      '.synopsis-wrap .synopsis', // Synopsis wrap
      '[data-qa="movie-info-synopsis"]', // Synopsis with data-qa
      '.synopsis .clamp', // Synopsis clamp
      '.movie-info-synopsis', // Movie info synopsis
      '.plot-synopsis', // Plot synopsis
      '.content_body', // Content body
      '.movie_details_summary' // Movie details summary
    ];

    const overview = this.extractor.extractOverview(overviewSelectors);

    // Create standardized media data
    return this.createMediaData({
      imdbId,
      title,
      year,
      mediaType,
      posterUrl,
      overview
    });
  }

  /**
   * Get site-specific CSS for Rotten Tomatoes with signature red theme
   */
  getSiteSpecificCSS() {
    return `
      /* Rotten Tomatoes Red Theme Override */
      
      .seerr-tab {
        background: linear-gradient(135deg, #fa320a 0%, #d42009 100%) !important;
        border-color: #fa320a !important;
        box-shadow: -2px 0 12px rgba(250, 50, 10, 0.3) !important;
      }
      
      .seerr-tab:hover {
        background: linear-gradient(135deg, #d42009 0%, #b71c08 100%) !important;
        border-color: #d42009 !important;
        box-shadow: -6px 0 16px rgba(250, 50, 10, 0.4) !important;
      }
      
      /* RT red theme for default/request states only */
      .seerr-action-button:not(.available):not(.ready):not(.partial):not(.pending):not(.error),
      .seerr-action-button.request {
        background: linear-gradient(135deg, #fa320a 0%, #d42009 100%) !important;
        border-color: #fa320a !important;
      }
      
      .seerr-action-button:not(.available):not(.ready):not(.partial):not(.pending):not(.error):hover:not(:disabled),
      .seerr-action-button.request:hover:not(:disabled) {
        background: linear-gradient(135deg, #d42009 0%, #b71c08 100%) !important;
        border-color: #d42009 !important;
        box-shadow: 0 4px 12px rgba(250, 50, 10, 0.3) !important;
      }
      
      .seerr-request-button:not(.available):not(.ready):not(.partial):not(.pending):not(.error),
      .seerr-request-button.request {
        background: linear-gradient(135deg, #fa320a 0%, #d42009 100%) !important;
        border-color: #fa320a !important;
      }
      
      .seerr-request-button:not(.available):not(.ready):not(.partial):not(.pending):not(.error):hover:not(:disabled),
      .seerr-request-button.request:hover:not(:disabled) {
        background: linear-gradient(135deg, #d42009 0%, #b71c08 100%) !important;
        border-color: #d42009 !important;
        box-shadow: 0 4px 12px rgba(250, 50, 10, 0.3) !important;
      }
      
      /* RT-specific status colors for consistency */
      .seerr-status-icon.available {
        background: #3478c1 !important; /* RT blue CTA color */
      }
      
      .seerr-status-icon.ready,
      .seerr-status-icon.partial {
        background: #3478c1 !important; /* RT blue CTA color */
      }
      
      .seerr-status-icon.pending {
        background: #ff8800 !important; /* RT orange */
      }
      
      .seerr-status-icon.downloading {
        background: #3478c1 !important; /* RT blue for downloading */
      }
      
      .seerr-status-icon.error {
        background: #fa320a !important; /* RT red for errors */
      }
      
      /* RT tab status colors - optimized for red theme visibility */
      .seerr-connection-status.available {
        color: #ffffff !important; /* White for available - no vibrating colors */
      }
      
      .seerr-connection-status.pending {
        color: #ffffff !important; /* White for pending - better visibility than orange on red */
      }
      
      .seerr-connection-status.downloading {
        color: #87ceeb !important; /* Light blue for downloading - softer than vibrating blue */
      }
      
      .seerr-connection-status.ready {
        color: #ffffff !important; /* White for ready */
      }
      
      .seerr-connection-status.partial {
        color: #ffffff !important; /* White for partial */
      }
      
      .seerr-connection-status.error {
        color: #ffffff !important; /* White for visibility on red */
      }
      
      .seerr-connection-status.checking {
        color: #ffffff !important; /* White for loading on red */
      }
      
      /* Use RT's blue CTA color for available/ready states */
      .seerr-action-button.available,
      .seerr-action-button.ready,
      .seerr-action-button.partial {
        background: linear-gradient(135deg, #3478c1 0%, #2968a3 100%) !important;
        border-color: #3478c1 !important;
        color: white !important;
      }
      
      .seerr-action-button.available:hover:not(:disabled),
      .seerr-action-button.ready:hover:not(:disabled),
      .seerr-action-button.partial:hover:not(:disabled) {
        background: linear-gradient(135deg, #2968a3 0%, #1e5085 100%) !important;
        border-color: #2968a3 !important;
        box-shadow: 0 4px 12px rgba(52, 120, 193, 0.4) !important;
      }
      
      /* Also apply to regular request buttons when available */
      .seerr-request-button.available,
      .seerr-request-button.ready,
      .seerr-request-button.partial {
        background: linear-gradient(135deg, #3478c1 0%, #2968a3 100%) !important;
        border-color: #3478c1 !important;
        color: white !important;
      }
      
      .seerr-request-button.available:hover:not(:disabled),
      .seerr-request-button.ready:hover:not(:disabled),
      .seerr-request-button.partial:hover:not(:disabled) {
        background: linear-gradient(135deg, #2968a3 0%, #1e5085 100%) !important;
        border-color: #2968a3 !important;
        box-shadow: 0 4px 12px rgba(52, 120, 193, 0.4) !important;
      }
      
      /* Pending state should stay orange/yellow like RT */
      .seerr-action-button.pending,
      .seerr-request-button.pending {
        background: linear-gradient(135deg, #ff8800 0%, #e67600 100%) !important;
        border-color: #ff8800 !important;
        color: white !important;
      }
      
      /* Error state uses RT red */
      .seerr-action-button.error,
      .seerr-request-button.error {
        background: linear-gradient(135deg, #fa320a 0%, #d42009 100%) !important;
        border-color: #fa320a !important;
        color: white !important;
      }
    `;
  }
}

// Wait for shared libraries to load, then initialize
function initializeRottenTomatoesIntegration() {
  if (typeof BaseIntegration !== 'undefined' && 
      typeof SeerrClient !== 'undefined' && 
      typeof MediaExtractor !== 'undefined' && 
      typeof UIComponents !== 'undefined') {
    
    console.log('🚀 [Rotten Tomatoes] All shared libraries loaded, initializing integration...');
    new RottenTomatoesIntegration();
  } else {
    console.log('⏳ [Rotten Tomatoes] Waiting for shared libraries to load...');
    setTimeout(initializeRottenTomatoesIntegration, 100);
  }
}

// Start initialization
initializeRottenTomatoesIntegration();
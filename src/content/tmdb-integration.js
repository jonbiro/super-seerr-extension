// TheMovieDB.org Integration for Seerr
// Uses new shared library architecture

console.log('🎬 [TMDb] Integration script loaded!', window.location.href);

class TMDbIntegration extends BaseIntegration {
  constructor() {
    super('TMDb', {
      debug: false, // Set to true for debugging
      uiTheme: 'flyout', // Use flyout interface like RT
      retryDelay: 2000,
      retryAttempts: 3
    });

    this.init();
  }

  /**
   * Extract media data from TMDb page
   * @returns {Object|null} Media data object or null
   */
  async extractMediaData() {
    this.log('Extracting media data from TMDb page...');

    // Determine media type from URL
    const url = window.location.pathname;
    let mediaType = 'movie';
    let tmdbId = null;

    // Parse URL patterns
    const movieMatch = url.match(/^\/movie\/(\d+)/);
    const tvMatch = url.match(/^\/tv\/(\d+)/);
    
    if (movieMatch) {
      mediaType = 'movie';
      tmdbId = parseInt(movieMatch[1]);
      this.log('Detected movie from URL, TMDb ID:', tmdbId);
    } else if (tvMatch) {
      mediaType = 'tv';
      tmdbId = parseInt(tvMatch[1]);
      this.log('Detected TV show from URL, TMDb ID:', tmdbId);
    } else {
      this.log('URL does not match movie or TV pattern:', url);
      return null;
    }

    // Extract title
    const titleSelectors = [
      'h2[data-testid="original-title"]', // TMDb's main title element
      'h2.title', // Fallback title selector
      '.title h2', // Alternative structure
      'h1', // Generic fallback
      '.original_title', // Old TMDb selector
    ];

    const title = this.extractor.extractTitle(titleSelectors, {
      cleanupPatterns: [
        /\s*\(\d{4}\)\s*$/, // Remove year in parentheses
        /\s*–.*$/, // Remove everything after dash
      ]
    });

    if (!title) {
      this.log('No title found');
      return null;
    }

    // Extract year
    const yearSelectors = [
      'span.release_date', // TMDb release date
      '.facts .release', // Release info section
      'time', // Generic time element
      '.release_date', // Alternative selector
      '[data-testid="release-date"]', // Test ID selector
    ];

    const year = this.extractor.extractYear(yearSelectors, {
      multiElementSelector: '.facts span', // Check all facts spans
      fallback: true
    });

    // Try to extract IMDB ID from external links
    const imdbSelectors = [
      'a[href*="imdb.com/title/"]',
      'a[data-testid="imdb-link"]',
      '.external_links a[href*="imdb"]',
      '.social_links a[href*="imdb"]'
    ];

    const imdbId = this.extractor.extractImdbId(imdbSelectors);

    // Extract poster
    const posterSelectors = [
      '.poster img', // Main poster
      '.image_content img', // Alternative poster
      'img[data-testid="poster"]', // Test ID selector
      '.poster .image_content img' // Nested poster
    ];

    const posterUrl = this.extractor.extractPosterUrl(posterSelectors);

    // Extract overview
    const overviewSelectors = [
      '.overview p', // Main overview paragraph
      '[data-testid="overview"] p',
      '.plot_summary .overview',
      '.summary .overview',
      '.overview' // Direct overview element
    ];

    const overview = this.extractor.extractOverview(overviewSelectors);

    // Create standardized media data
    return this.createMediaData({
      imdbId,
      title,
      year,
      mediaType,
      posterUrl,
      overview,
      tmdbId // Include TMDb ID since this is TMDb!
    });
  }

  getSiteSpecificCSS() {
    return `
      /* TMDb Blue Theme Override */
      
      .seerr-tab {
        background: linear-gradient(135deg, #01b4e4 0%, #90cea1 100%) !important;
        border-color: #01b4e4 !important;
        box-shadow: -2px 0 12px rgba(1, 180, 228, 0.3) !important;
      }
      
      .seerr-tab:hover {
        background: linear-gradient(135deg, #0099cc 0%, #7bb18a 100%) !important;
        border-color: #0099cc !important;
        box-shadow: -6px 0 16px rgba(1, 180, 228, 0.4) !important;
      }
      
      /* TMDb blue theme for all button states (consistent branding) */
      .seerr-action-button {
        background: linear-gradient(135deg, #01b4e4 0%, #90cea1 100%) !important;
        border-color: #01b4e4 !important;
      }
      
      .seerr-action-button:hover:not(:disabled) {
        background: linear-gradient(135deg, #0099cc 0%, #7bb18a 100%) !important;
        border-color: #0099cc !important;
        box-shadow: 0 4px 12px rgba(1, 180, 228, 0.4) !important;
      }
      
      .seerr-request-button {
        background: linear-gradient(135deg, #01b4e4 0%, #90cea1 100%) !important;
        border-color: #01b4e4 !important;
      }
      
      .seerr-request-button:hover:not(:disabled) {
        background: linear-gradient(135deg, #0099cc 0%, #7bb18a 100%) !important;
        border-color: #0099cc !important;
        box-shadow: 0 4px 12px rgba(1, 180, 228, 0.4) !important;
      }
      
      /* TMDb-specific status indicator colors (Issue #2 fix) */
      .seerr-status-icon.available {
        background: #90cea1 !important; /* TMDb green accent */
      }
      
      .seerr-status-icon.pending {
        background: #fdb462 !important; /* Warm orange that works with blue */
      }
      
      .seerr-status-icon.downloading {
        background: #01b4e4 !important; /* TMDb blue for downloading */
      }
      
      .seerr-status-icon.error {
        background: #e74c3c !important; /* Clear red that works with blue theme */
      }
      
      .seerr-status-icon.partial {
        background: #90cea1 !important; /* TMDb green since content is available */
      }
      
      /* TMDb tab status colors - white for better visibility on blue gradient */
      .seerr-connection-status.available {
        color: #ffffff !important; /* White - matches tab text, excellent contrast */
      }
      
      .seerr-connection-status.pending {
        color: #ffffff !important; /* White - much better visibility than orange */
      }
      
      .seerr-connection-status.downloading {
        color: #ffffff !important; /* White - better than blue on blue */
      }
      
      .seerr-connection-status.ready {
        color: #ffffff !important; /* White for consistency */
      }
      
      .seerr-connection-status.error {
        color: #ff6b6b !important; /* Bright red - clear error indication */
      }
      
      .seerr-connection-status.partial {
        color: #ffffff !important; /* White for consistency */
      }
      
      .seerr-connection-status.checking {
        color: #e0e0e0 !important; /* Light gray for loading state */
      }
    `;
  }
}

// Wait for our shared libraries to load, then initialize
function initializeTMDbIntegration() {
  if (typeof BaseIntegration !== 'undefined' && 
      typeof SeerrClient !== 'undefined' && 
      typeof MediaExtractor !== 'undefined' && 
      typeof UIComponents !== 'undefined') {
    
    console.log('🚀 [TMDb] All shared libraries loaded, initializing integration...');
    new TMDbIntegration();
  } else {
    console.log('⏳ [TMDb] Waiting for shared libraries to load...');
    setTimeout(initializeTMDbIntegration, 100);
  }
}

// Start initialization
initializeTMDbIntegration();
// Filmweb.pl Integration for Seerr
// Uses shared library architecture with flyout UI and yellow/black theme

console.log('🎬 [Filmweb] Integration script loaded!', window.location.href);

class FilmwebIntegration extends BaseIntegration {
  constructor() {
    super('Filmweb', {
      debug: false,
      uiTheme: 'flyout',
      retryDelay: 2000,
      retryAttempts: 3
    });

    this.init();
  }

  /**
   * Extract media data from Filmweb page
   * @returns {Object|null} Media data object or null
   */
  async extractMediaData() {
    this.log('Extracting media data from Filmweb page...');

    // Determine media type first to use correct selectors
    const isTV = window.location.pathname.includes('/serial/');
    const mediaType = isTV ? 'tv' : 'movie';
    this.log('Detected media type:', mediaType);

    // Title selectors
    const titleSelectors = [
      'h1.filmTitle__title',
      'h1.serialTitle__title',
      'h1[itemprop="name"]',
      '.filmCoverSection__title',
      '.serialCoverSection__title'
    ];

    // Try to get original title first as it's often better for search
    const originalTitleSelectors = [
      '.filmTitle__originalTitle',
      '.serialTitle__originalTitle',
      '.filmCoverSection__originalTitle',
      '.serialCoverSection__originalTitle'
    ];

    let title = this.extractor.extractTextFromSelectors(originalTitleSelectors, 'original title');

    if (title) {
      title = title
          .replace(/\s*\(\d{4}\)\s*$/g, '') // Remove year in parentheses
          .replace(/\s*\d{4}\s*$/g, '') // Remove trailing year with spaces
          .trim();

      // Ensure title is not empty after cleanup
      if (!title) {
        title = null;
      }
    }

    if (!title) {
      title = this.extractor.extractTitle(titleSelectors, {
        cleanupPatterns: [
          /\s*\(\d{4}\)\s*$/, // Remove year in parentheses
          /\s*\d{4}\s*$/, // Remove trailing year
        ]
      });
    }

    if (!title) {
      this.log('No title found');
      return null;
    }

    // Year selectors
    const yearSelectors = [
      '.filmTitle__year',
      '.serialTitle__year',
      '.filmCoverSection__year',
      '.serialCoverSection__year',
      'span[itemprop="datePublished"]'
    ];

    const year = this.extractor.extractYear(yearSelectors, {
      fallback: true
    });

    // Poster selectors
    const posterSelectors = [
      '.filmPosterSection__poster img',
      '.serialPosterSection__poster img',
      '.filmCoverSection__poster img',
      '.serialCoverSection__poster img',
      'img[alt*="Plakat"]',
      'img.filmPoster__image',
      'img.serialPoster__image'
    ];

    const posterUrl = this.extractor.extractPosterUrl(posterSelectors);

    // Overview selectors
    const overviewSelectors = [
      '.filmPlotSection__content',
      '.serialPlotSection__content',
      '.description__text',
      '[itemprop="description"]'
    ];

    const overview = this.extractor.extractOverview(overviewSelectors);

    // Try to find IMDB ID on the page (sometimes available in external links)
    const imdbId = this.extractor.extractImdbId([
      'a[href*="imdb.com/title/"]',
      'a[href*="imdb.com"]'
    ]);

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
   * Get site-specific CSS for Filmweb with signature yellow theme
   */
  getSiteSpecificCSS() {
    return `
      /* Filmweb Yellow Theme Override */
      
      .seerr-tab {
        background: linear-gradient(135deg, #ffca28 0%, #ffa000 100%) !important;
        border-color: #ffca28 !important;
        box-shadow: -2px 0 12px rgba(255, 202, 40, 0.3) !important;
        color: #000 !important;
      }
      
      .seerr-tab:hover {
        background: linear-gradient(135deg, #ffa000 0%, #f57c00 100%) !important;
        border-color: #ffa000 !important;
        box-shadow: -6px 0 16px rgba(255, 202, 40, 0.4) !important;
      }
      
      .seerr-tab-text {
        color: #000 !important;
      }
      
      .seerr-action-button {
        background: linear-gradient(135deg, #ffca28 0%, #ffa000 100%) !important;
        border-color: #ffca28 !important;
        color: #000 !important;
      }
      
      .seerr-action-button:hover:not(:disabled) {
        background: linear-gradient(135deg, #ffa000 0%, #f57c00 100%) !important;
        border-color: #ffa000 !important;
        box-shadow: 0 4px 12px rgba(255, 202, 40, 0.3) !important;
      }
      
      .seerr-status-icon.available {
        background: #4caf50 !important;
      }
      
      .seerr-status-icon.pending {
        background: #ff9800 !important;
      }
      
      .seerr-status-icon.downloading {
        background: #2196f3 !important;
      }
      
      .seerr-status-icon.ready {
        background: #4caf50 !important;
      }
      
      .seerr-connection-status.available,
      .seerr-connection-status.pending,
      .seerr-connection-status.ready,
      .seerr-connection-status.partial {
        color: #000000 !important;
      }
      
      .seerr-connection-status.downloading {
        color: #2196f3 !important;
      }
      
      .seerr-connection-status.error {
        color: #d32f2f !important;
      }
      
      .seerr-connection-status.checking {
        color: #757575 !important;
      }
    `;
  }
}

// Wait for shared libraries to load, then initialize
function initializeFilmwebIntegration() {
  if (typeof BaseIntegration !== 'undefined' && 
      typeof SeerrClient !== 'undefined' && 
      typeof MediaExtractor !== 'undefined' && 
      typeof UIComponents !== 'undefined') {
    
    console.log('🚀 [Filmweb] All shared libraries loaded, initializing integration...');
    new FilmwebIntegration();
  } else {
    console.log('⏳ [Filmweb] Waiting for shared libraries to load...');
    setTimeout(initializeFilmwebIntegration, 100);
  }
}

// Start initialization
initializeFilmwebIntegration();

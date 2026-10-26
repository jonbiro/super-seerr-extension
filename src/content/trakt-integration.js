// Trakt.tv Integration for Seerr
// Uses shared library architecture with flyout UI and Trakt's signature purple/pink theme

class TraktIntegration extends BaseIntegration {
  constructor() {
    super('Trakt', {
      debug: false, // Set to true for debugging
      uiTheme: 'flyout', // Use flyout interface
      retryDelay: 2000,
      retryAttempts: 3
    });

    this.init();
  }

  // Trakt changes ?season=... while staying on the same show. The media
  // identity lives in the path, so those view-only changes must not retire an
  // open Seerr panel or cancel an action for the same show.
  getNavigationKey() {
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    return `${window.location.origin}${path}`;
  }

  /**
   * Extract media data from Trakt page
   * @returns {Object|null} Media data object or null
   */
  async extractMediaData() {
    this.log('Extracting media data from Trakt page...');

    // Reuse the shared edge-page guard so common provider variants such as
    // “403 - Forbidden” cannot fall through to slug-based title extraction.
    if (this.isBlockedProviderPage()) return null;

    // Cloudflare and other edge challenges can keep a Trakt title-shaped URL
    // while replacing the document with an error page.  The generic heading
    // fallback below would otherwise turn messages such as “Sorry, you have
    // been blocked” into a requestable media title.  Leave the page inert
    // until the real title document is available.
    const documentTitle = document.title.trim();
    if (/^(?:attention required|just a moment|access denied|verify you are human)(?:\s*[|:-]|\s*$)/i.test(documentTitle)) {
      return null;
    }

    // Determine media type from URL - handle both trakt.tv and app.trakt.tv
    const url = window.location.pathname;
    const fullUrl = window.location.href;
    let mediaType = 'movie';
    let urlMatch = null;

    this.log('Analyzing URL:', fullUrl);
    this.log('Pathname:', url);

    // Check for movie pages (both /movies/ and /movie/ patterns)
    if (url.includes('/movies/') || url.includes('/movie/')) {
      mediaType = 'movie';
      urlMatch = url.match(/^\/(movies?)\/([^/]+)\/?$/);
    }
    // Check for TV show pages (both /shows/ and /show/ patterns)
    else if (url.includes('/shows/') || url.includes('/show/')) {
      mediaType = 'tv';
      urlMatch = url.match(/^\/(shows?)\/([^/]+)(?:\/seasons\/\d+)?\/?$/);
    }
    else {
      this.log('URL does not match movie or show pattern:', url);
      return null;
    }

    this.log('URL match result:', urlMatch);

    if (!urlMatch) {
      this.log('Could not extract media slug from URL:', url);
      return null;
    }

    this.log(`Detected ${mediaType} page from URL:`, urlMatch[2]);
    let decodedSlug = null;
    try { decodedSlug = decodeURIComponent(urlMatch[2]); }
    catch (_) { /* A visible page title can still identify an undecodable URL. */ }
    const slugYearMatch = decodedSlug?.match(/-(\d{4})$/);
    const slugYear = slugYearMatch ? this.extractor.parseReleaseYear(slugYearMatch[1]) : null;
    const slugTitle = slugYear === null ? decodedSlug : decodedSlug.slice(0, slugYearMatch.index);
    let fallbackYear = null;

    // Extract title - Trakt has clean, semantic structure
    // Enhanced selectors for both trakt.tv and app.trakt.tv
    const titleSelectors = [
      '[data-test-id="movie-title"]', // Movie title
      '[data-test-id="show-title"]', // Show title  
      'h1[itemprop="name"]', // Structured data title
      '.summary h1', // Summary title
      '.movie-title h1', // Movie title wrapper
      '.show-title h1', // Show title wrapper
      'h1.title', // Generic title
      '.title h1', // Alternative title
      '.header h1', // Header title
      '.show-header h1', // Show header
      '.movie-header h1', // Movie header
      'h1', // Fallback
      '.page-title h1', // Page title
      'title' // HTML title as last resort
    ];

    this.log('Searching for title with selectors:', titleSelectors);

    let title = this.extractor.extractTitle(titleSelectors, {
      cleanupPatterns: [
        /\s*\(\d{4}\)\s*$/, // Remove year in parentheses
        /\s*-\s*Trakt.*$/, // Remove Trakt suffix (flexible)
        /\s*\|\s*Trakt.*$/, // Remove | Trakt suffix
        /^Trakt Web:\s*/, // Remove "Trakt Web:" prefix
      ]
    });

    if (/^(?:sorry,?\s+you\s+have\s+been\s+blocked|access denied|forbidden|just a moment\.*|verify you are human)$/i.test(title?.trim() || '')) {
      return null;
    }

    this.log('Extracted title before cleanup:', title);

    // Some app pages initially expose only a generic title, so reconstruct it
    // from the slug. Once the real title appears, retain a slug year only when
    // the preceding slug text agrees with that title; this avoids treating a
    // literal title such as "Space: 1999" as a release year.
    if (!title || /^(?:Trakt(?: Web)?|Track Your Shows & Movies)$/i.test(title.trim()) || title.trim() === '') {
      this.log('Title extraction failed, trying to extract from URL slug');
      // Trakt also accepts numeric media IDs in the URL. A generic shell or
      // edge-error page at such a route has no human-readable identity, so
      // displaying the ID as a requestable title would create a false flyout.
      if (decodedSlug && !/^\d+$/.test(decodedSlug)) {
        fallbackYear = slugYear;
        // Convert URL slug to title (e.g., "peacemaker-2022" -> "Peacemaker")
        title = (fallbackYear === null ? decodedSlug : slugTitle)
          .replace(/-/g, ' ') // Replace dashes with spaces
          .replace(/(^|\s)\p{L}/gu, l => l.toUpperCase()).trim(); // Preserve Unicode letters within words.
        this.log('Extracted title from URL slug:', title);
      } else return null; // A generic application title cannot identify an invalid slug or numeric ID.
    } else if (slugYear !== null) {
      const normalize = value => value.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      if (normalize(slugTitle.replace(/[-_]+/g, ' ')) === normalize(title)) fallbackYear = slugYear;
    }

    this.log('Final extracted title:', title);

    if (!title) {
      this.log('No title found');
      return null;
    }

    // Extract year from multiple sources
    const yearSelectors = [
      '.summary .year', // Summary year
      '[data-test-id="movie-year"]', // Movie year
      '[data-test-id="show-year"]', // Show year
      '.movie-stats .year', // Movie stats year
      '.show-stats .year', // Show stats year
      'time[datetime]', // Time element
      '.release-date', // Release date
      '.aired', // Air date for TV shows
      '.metadata .year' // Metadata year
    ];

    const year = this.extractor.extractYear(yearSelectors, {
      fallback: true
    }) ?? fallbackYear;

    // Try to find TMDb ID - Trakt often has TMDb links/data
    let tmdbId = null;
    const tmdbSelectors = [
      'a[href*="themoviedb.org"]',
      '[data-tmdb-id]',
      '.external-links a[href*="tmdb"]'
    ];

    for (const selector of tmdbSelectors) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        if (element.href) {
          try {
            const external = new URL(element.href);
            const match = external.pathname.match(/^\/(movie|tv)\/(\d+)(?:-[^/]+)?\/?$/);
            if (['http:', 'https:'].includes(external.protocol) &&
                ['themoviedb.org', 'www.themoviedb.org'].includes(external.hostname) &&
                match?.[1] === mediaType) {
              const id = Number(match[2]);
              if (Number.isSafeInteger(id) && id > 0) {
                tmdbId = id;
                break;
              }
            }
          } catch (_) { /* Ignore malformed external links. */ }
        }
        const rawId = element.dataset.tmdbId;
        if (rawId && /^\d+$/.test(rawId)) {
          const id = Number(rawId);
          if (Number.isSafeInteger(id) && id > 0) {
            tmdbId = id;
            break;
          }
        }
      }
      if (tmdbId) break;
    }

    // Try to find IMDB ID
    const imdbSelectors = [
      'a[href*="imdb.com/title/"]',
      '[data-imdb-id]',
      '.external-links a[href*="imdb"]'
    ];

    const imdbId = this.extractor.extractImdbId(imdbSelectors);

    // Extract poster - Trakt has prominent poster displays
    const posterSelectors = [
      '.poster img', // Main poster
      '.movie-poster img', // Movie poster
      '.show-poster img', // Show poster
      '[data-test-id="poster"] img', // Test ID poster
      '.summary-poster img', // Summary poster
      '.fanart img', // Fanart image
      '.poster-container img' // Poster container
    ];

    const posterUrl = this.extractor.extractPosterUrl(posterSelectors);

    // Extract overview/plot
    const overviewSelectors = [
      '[data-test-id="movie-overview"]', // Movie overview
      '[data-test-id="show-overview"]', // Show overview
      '.summary .overview', // Summary overview
      '.plot .overview', // Plot overview
      '[itemprop="description"]', // Structured data description
      '.description', // Generic description
      '.synopsis', // Synopsis
      '.plot' // Plot
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
      tmdbId // Include TMDb ID if found
    });
  }

  /**
   * Get site-specific CSS for Trakt with signature purple/pink theme
   */
  getSiteSpecificCSS() {
    return `
      /* Trakt Purple/Pink Theme Override */
      
      .seerr-tab {
        background: linear-gradient(135deg, #dc1b23 0%, #932b86 100%) !important;
        border-color: #ed1c24 !important;
        box-shadow: -2px 0 12px rgba(237, 28, 36, 0.3) !important;
      }
      
      .seerr-tab:hover {
        background: linear-gradient(135deg, #932b86 0%, #6d1f64 100%) !important;
        border-color: #932b86 !important;
        box-shadow: -6px 0 16px rgba(237, 28, 36, 0.4) !important;
      }
      
      .seerr-action-button {
        background: linear-gradient(135deg, #dc1b23 0%, #932b86 100%) !important;
        border-color: #ed1c24 !important;
        color: white !important;
      }
      
      .seerr-action-button:hover:not(:disabled) {
        background: linear-gradient(135deg, #932b86 0%, #6d1f64 100%) !important;
        border-color: #932b86 !important;
        box-shadow: 0 4px 12px rgba(237, 28, 36, 0.3) !important;
      }
      
      .seerr-request-button {
        background: linear-gradient(135deg, #dc1b23 0%, #932b86 100%) !important;
        border-color: #ed1c24 !important;
        color: white !important;
      }
      
      .seerr-request-button:hover:not(:disabled) {
        background: linear-gradient(135deg, #932b86 0%, #6d1f64 100%) !important;
        border-color: #932b86 !important;
        box-shadow: 0 4px 12px rgba(237, 28, 36, 0.3) !important;
      }
      
      /* Trakt-specific status colors */
      .seerr-status-icon.available {
        background: #52c41a !important; /* Green for available */
      }
      
      .seerr-status-icon.pending {
        background: #fa8c16 !important; /* Orange for pending */
      }
      
      .seerr-status-icon.downloading {
        background: #1890ff !important; /* Blue for downloading */
      }
      
      .seerr-status-icon.error {
        background: #ed1c24 !important; /* Trakt red for errors */
      }
      
      .seerr-status-icon.partial {
        background: #52c41a !important; /* Green like available */
      }
      
      /* Trakt tab status colors - optimized for red/purple theme visibility */
      .seerr-connection-status.available {
        color: #52c41a !important; /* Bright green */
      }
      
      .seerr-connection-status.pending {
        color: #fadb14 !important; /* Yellow - complements green and works on red/purple */
      }
      
      .seerr-connection-status.downloading {
        color: #1890ff !important; /* Blue */
      }
      
      .seerr-connection-status.ready {
        color: #52c41a !important; /* Bright green */
      }
      
      .seerr-connection-status.partial {
        color: #52c41a !important; /* Bright green */
      }
      
      .seerr-connection-status.error {
        color: #ff4d4f !important; /* Bright red for visibility on dark bg */
      }
      
      .seerr-connection-status.checking {
        color: #d9d9d9 !important; /* Light gray for loading */
      }
      
      /* Special styling for Trakt's dark theme */
      @media (prefers-color-scheme: dark) {
        .seerr-tab {
          box-shadow: -2px 0 12px rgba(237, 28, 36, 0.5) !important;
        }
        
        .seerr-panel {
          background: #1a1a1a !important;
          border-color: #ed1c24 !important;
        }
      }
    `;
  }
}

// Wait for shared libraries to load, then initialize
function initializeTraktIntegration() {
  if (typeof BaseIntegration !== 'undefined' && 
      typeof SeerrClient !== 'undefined' && 
      typeof MediaExtractor !== 'undefined' && 
      typeof UIComponents !== 'undefined') {
    
    new TraktIntegration();
  } else {
    setTimeout(initializeTraktIntegration, 100);
  }
}

// Start initialization
initializeTraktIntegration();

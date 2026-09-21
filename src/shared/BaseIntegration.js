// Base Integration Class
// Common functionality for all site integrations using shared libraries

class BaseIntegration {
  constructor(siteName, options = {}) {
    this.siteName = siteName;
    this.debug = options.debug || false;
    this.uiTheme = options.uiTheme || 'button'; // 'button' or 'flyout'
    // ?? not ||, so a caller asking for no delay gets none.
    this.retryDelay = Math.max(0, options.retryDelay ?? 2000);

    // Initialize shared components
    this.client = new SeerrClient({
      debug: this.debug,
      siteName: this.siteName,
      retryAttempts: options.retryAttempts ?? 3
    });

    this.extractor = new MediaExtractor({
      debug: this.debug,
      siteName: this.siteName
    });

    this.ui = new UIComponents({
      debug: this.debug,
      siteName: this.siteName,
      theme: this.uiTheme
    });

    this.destroyed = false;
    this._initialized = false;
    this._requestInFlight = false;

    // State
    this.mediaData = null;
    this.uiElements = {};
    this.currentUrl = window.location.href;
    this.navigationListener = null;
    this.currentStatusData = null; // Cache current status data for performance
    this.plexConfigured = false;
    this._pendingRetries = new Set();

    this.log('BaseIntegration initialized for', this.siteName);
  }

  log(...args) {
    if (this.debug) console.log(`🔗 [${this.siteName}]`, ...args);
  }

  error(...args) {
    console.error(`🚨 [${this.siteName}]`, ...args);
  }

  /**
   * Check if flyout is currently expanded
   */
  isFlyoutExpanded() {
    return this.uiElements.flyout?.classList.contains('expanded');
  }

  /**
   * Check if flyout exists in the DOM
   */
  hasFlyout() {
    return this.uiElements.flyout && this.uiElements.flyout.parentNode;
  }

  /**
   * Initialize the integration
   * Should be called by child classes
   */
  async init() {
    if (this._initialized) return;
    this._initialized = true;
    this.log('Initializing integration...');

    // Inject shared styles
    this.ui.injectStyles(this.getSiteSpecificCSS());

    // Wait for page to be ready
    if (document.readyState === 'loading') {
      this.log('Document loading, waiting for DOMContentLoaded');
      document.addEventListener('DOMContentLoaded', () => this.extractAndSetup());
    } else {
      this.log('Document ready, starting extraction');
      this.extractAndSetup();
    }

    // Retry after delay for dynamic content
    this.deferRetry(() => {
      this.log(`Retry extraction after ${this.retryDelay}ms`);
      this.extractAndSetup().catch(err => this.error('Retry extraction failed:', err));
    }, this.retryDelay);

    // Setup SPA navigation detection
    this.setupNavigationDetection();
    this.setupLifecycleHandlers();
  }

  /**
   * A retry timer that never fires on a destroyed instance. Raw setTimeout
   * calls here resurrected UI after destroy: the callback ran extractAndSetup
   * on a page that no longer wanted it.
   */
  deferRetry(fn, delay) {
    const id = setTimeout(() => {
      this._pendingRetries.delete(id);
      if (!this.destroyed) fn();
    }, delay);
    this._pendingRetries.add(id);
    return id;
  }

  clearPendingRetries() {
    for (const id of this._pendingRetries) clearTimeout(id);
    this._pendingRetries.clear();
  }

  /**
   * Release the polling timer while the page is in the back/forward cache, and
   * re-arm it if the page is restored. Without this the interval outlives the
   * page: destroy() existed but nothing ever called it.
   */
  setupLifecycleHandlers() {
    if (this._lifecycleBound) return;
    this._lifecycleBound = true;

    this._pagehideListener = () => this.suspendNavigationPolling();
    this._pageshowListener = () => {
      if (!this.destroyed) this.resumeNavigationPolling();
    };
    window.addEventListener('pagehide', this._pagehideListener);
    window.addEventListener('pageshow', this._pageshowListener);
  }

  suspendNavigationPolling() {
    if (this.navigationListener) {
      clearInterval(this.navigationListener);
      this.navigationListener = null;
    }
  }

  resumeNavigationPolling() {
    if (this.navigationListener) return;
    this.navigationListener = setInterval(() => this.pollForNavigation(), 1000);
  }

  pollForNavigation() {
    if (this.destroyed) return;
    const newUrl = window.location.href;
    if (newUrl !== this.currentUrl) {
      this.log('Navigation detected via polling:', this.currentUrl, '->', newUrl);
      this.currentUrl = newUrl;
      this.handleNavigationChange();
    }
  }

  /**
   * Extract media data and setup UI
   * Override extractMediaData() in child classes
   */
  async extractAndSetup() {
    const generation = this._extractionGeneration = (this._extractionGeneration || 0) + 1;
    const pageUrl = window.location.href;
    try {
      this.log('Starting media data extraction...');
      let mediaData = await this.extractMediaData();
      if (mediaData?.title) {
        try {
          const saved = await this.client.sendMessage({ action: 'getSavedTitleCorrection', data: mediaData });
          if (saved?.success && saved.data?.tmdbId && saved.data?.title && saved.data.mediaType === mediaData.mediaType) {
            mediaData = { ...mediaData, ...saved.data };
          }
        } catch (_) { /* Matching stays available if local storage is unavailable. */ }
      }
      if (this.destroyed || generation !== this._extractionGeneration || window.location.href !== pageUrl) return;
      this.log('Extracted media data:', mediaData);

      if (mediaData && mediaData.title) {
        // A same-page retry must not replace the identity behind an open panel
        // while its status lookup is still using that identity.
        if (this.isFlyoutExpanded() && this.mediaData
          && ['title', 'mediaType', 'tmdbId', 'imdbId', 'year'].every(key => this.mediaData[key] === mediaData[key])) return;
        if (this.isFlyoutExpanded()) this.cleanupUI();
        this.mediaData = mediaData;
        this.log('Valid media data found, setting up UI...');
        await this.setupUI();
      } else {
        this.log('No valid media data found');
      }
    } catch (err) {
      this.error('Error in extractAndSetup:', err);
    }
  }

  /**
   * Extract media data from the page
   * MUST be implemented by child classes
   */
  async extractMediaData() {
    throw new Error('extractMediaData() must be implemented by child class');
  }

  /**
   * Get site-specific CSS
   * Can be overridden by child classes
   */
  getSiteSpecificCSS() {
    return ''; // Override in child classes for site-specific styling
  }

  /**
   * Setup UI based on theme (button or flyout)
   */
  async setupUI() {
    if (this.uiTheme === 'flyout') {
      await this.setupFlyoutUI();
    } else {
      await this.setupButtonUI();
    }
  }

  async setupButtonUI() {
    if (this.destroyed) return;
    if (typeof this.getButtonInsertionPoint !== 'function') {
      this.error('Button UI requires getButtonInsertionPoint() — falling back to flyout');
      return this.setupFlyoutUI();
    }
    this.log('Setting up button UI...');

    // Check if button already exists
    if (this.uiElements.button && this.uiElements.button.parentNode) {
      this.log('Button already exists, skipping setup');
      return;
    }

    // Find insertion point (must be implemented by child class)
    const insertionPoint = this.getButtonInsertionPoint();
    if (!insertionPoint) {
      this.log('No insertion point found for button');
      return;
    }

    // Create button
    const button = this.ui.createRequestButton({
      text: 'Request on Seerr'
    });

    // Add click handler
    button.addEventListener('click', () => this.handleRequest());

    // Insert button
    insertionPoint.appendChild(button);
    this.uiElements.button = button;

    // Update with status
    await this.updateStatus();

    this.log('Button UI setup complete');
  }

  /**
   * Setup flyout UI (RT style)
   */
  async setupFlyoutUI() {
    this.log('Setting up flyout UI...');
    if (this.destroyed) return;

    // Preserve expanded flyout - don't recreate
    if (this.isFlyoutExpanded()) {
      this.log('Flyout is already expanded, skipping setup');
      return;
    }

    // Remove existing collapsed flyout
    if (this.hasFlyout()) {
      this.log('Removing existing collapsed flyout');
      this.uiElements.flyout.parentNode.removeChild(this.uiElements.flyout);
    }

    // Create new flyout
    const { flyout, tab, panel } = this.ui.createFlyout();
    const elements = this.ui.createFlyoutContent(this.mediaData, panel);

    // Add click handler to button
    elements.button.addEventListener('click', () => this.handleRequest());
    elements.seasonButton?.addEventListener('click', () => this.handleRequest({ seasonsOnly: true }));

    // Add watchlist click handler
    if (elements.watchlistButton) {
      elements.watchlistButton.addEventListener('click', () => this.handleWatchlistClick());
    }

    // True Plex Watchlist: separate token, separate product.
    if (elements.plexButton) {
      elements.plexButton.addEventListener('click', () => this.handlePlexWatchlistClick());
    }

    // Add flyout to page
    document.body.appendChild(flyout);

    // Store references
    this.uiElements = { flyout, tab, panel, ...elements };

    // Setup debug functions
    this.setupDebugFunctions();

    // Update with status
    await this.updateStatus();

    this.log('Flyout UI setup complete');
  }

  async updateStatus() {
    const generation = this._statusGeneration = (this._statusGeneration || 0) + 1;
    const media = this.mediaData;
    const elements = this.uiElements;
    const isCurrent = () => !this.destroyed && this._statusGeneration === generation
      && this.mediaData === media && this.uiElements === elements;
    try {
      this.log('Updating status...');

      // Update tab icon to loading state
      if (this.uiElements.tab) {
        this.ui.updateTabIcon(this.uiElements.tab, 'checking');
      }

      // Plex token state is independent of Seerr status; the worker reports
      // only whether a token exists, never the token itself.
      try {
        const config = await this.client.sendMessage({ action: 'getConfigState' });
        this.plexConfigured = config?.success === true && config.data?.plexConfigured === true;
      } catch (_) {
        this.plexConfigured = false;
      }

      if (!isCurrent()) return;

      // Plex state resolves alongside the Seerr lookup, never ahead of
      // rendering: a slow or failed lookup keeps the Add button rather than
      // blocking the flyout.
      const plexStatePromise = this.plexConfigured
        ? this.client.plexWatchlistState(media).catch(() => null)
        : Promise.resolve(null);

      // Get status from Seerr
      const statusData = await this.client.getMediaStatus(media);
      if (!isCurrent()) return;
      this.log('Status received:', statusData);

      // Cache status data for instant access during button clicks
      this.currentStatusData = statusData;

      const plexOnWatchlist = false;

      // Update UI based on theme
      if (this.uiTheme === 'flyout') {
        this.ui.updateFlyoutStatus(this.uiElements, statusData, { plexConfigured: this.plexConfigured, plexOnWatchlist });
        this.ui.updateTabIcon(this.uiElements.tab, statusData.status, statusData);

        if (this.uiElements.panel) {
          const mediaInfoEl = this.uiElements.panel.querySelector('.seerr-media-info');
          if (mediaInfoEl) {
            if (statusData.status === 'available_watch') {
              this.ui.showInLibraryBadge(mediaInfoEl);
            } else {
              this.ui.hideInLibraryBadge(mediaInfoEl);
            }
          }
        }
        void plexStatePromise.then(plexState => {
          if (!isCurrent() || this.currentStatusData !== statusData) return;
          // Update only the Plex control; a late read must not reset Seerr UI.
          this.ui.updatePlexWatchlistStatus(elements, statusData, {
            plexConfigured: this.plexConfigured,
            plexOnWatchlist: plexState?.onWatchlist === true
          });
        }).catch(err => this.log('Plex state update failed:', err));
      } else {
        this.ui.updateButtonStatus(this.uiElements.button, statusData);
      }

    } catch (err) {
      if (!isCurrent()) return;
      this.error('Error updating status:', err);
      this.log('Error details:', err.message);

      // Handle errors appropriately - be more specific about error types
      const errorStatus = this.getErrorStatus(err);
      this.currentStatusData = errorStatus;
      this.log('Determined error status:', errorStatus);

      if (this.uiTheme === 'flyout') {
        this.ui.updateFlyoutStatus(this.uiElements, errorStatus, { plexConfigured: this.plexConfigured });
        
        // Only update tab icon to error if it's actually a server connection error
        // Otherwise, default to 'available' status
        const tabStatus = errorStatus.status === 'error' ? 'error' : 'available';
        this.ui.updateTabIcon(this.uiElements.tab, tabStatus, errorStatus);

        if (this.uiElements.panel) {
          const mediaInfoEl = this.uiElements.panel.querySelector('.seerr-media-info');
          if (mediaInfoEl) {
            this.ui.hideInLibraryBadge(mediaInfoEl);
          }
        }
      } else {
        this.ui.updateButtonStatus(this.uiElements.button, errorStatus);
      }
    }
  }

  // Async actions belong to the title and UI that started them.
  captureActionView() {
    const media = this.mediaData;
    const elements = this.uiElements;
    const url = window.location.href;
    return { media, elements, isCurrent: () => !this.destroyed && this.mediaData === media
      && this.uiElements === elements && window.location.href === url };
  }

  deferViewAction(view, callback, delay) {
    this.deferRetry(() => { if (view.isCurrent()) callback(); }, delay);
  }

  async handleRequest({ seasonsOnly = false } = {}) {
    if (this._requestInFlight) return;
    this._requestInFlight = true;
    const attempt = this._requestAttempt = {};
    const view = this.captureActionView();

    if (!this.mediaData) {
      this._requestInFlight = false;
      this.ui.createNotification('Error', 'Could not extract media information', 'error');
      return;
    }

    this.log('Handling request for:', this.mediaData.title);

    const currentButton = this.uiElements.button;
    const buttonText = currentButton?.querySelector('span')?.textContent ?? '';
    // The label names whichever media server Seerr is configured against, so
    // the class is what identifies this button, not its text.
    const isWatchButton = currentButton?.classList.contains('watch') || /^Watch\b/.test(buttonText);

    this.log('Button analysis:', { buttonText, isWatchButton });

    try {
      if (this.currentStatusData?.action === 'retryStatus') {
        await this.updateStatus();
      } else if (this.currentStatusData?.action === 'choose') {
        await this.handleTitleChoice();
      } else if (isWatchButton && !seasonsOnly) {
        await this.handleWatchButtonClick();
      } else {
        await this.handleRequestButtonClick();
      }
    } catch (error) {
      if (view.isCurrent()) this.ui.createNotification('Seerr', error.message, 'error');
    } finally {
      if (this._requestAttempt === attempt) {
        this._requestInFlight = false;
        this._requestAttempt = null;
      }
    }
  }

  async handleTitleChoice() {
    const view = this.captureActionView();
    const response = await this.client.sendMessage({ action: 'getMediaCandidates', data: view.media });
    if (!view.isCurrent()) return;
    if (!response?.success || !Array.isArray(response.data)) throw new Error(response?.error || 'Could not load matching titles');
    const controller = new AbortController();
    this._titlePickerController?.abort();
    this._titlePickerController = controller;
    try {
      const selected = await this.ui.chooseTitle(response.data, { title: view.media.title, signal: controller.signal });
      if (!selected || !view.isCurrent()) return;
      if (selected.rememberChoice) {
        const saved = await this.client.sendMessage({ action: 'saveTitleCorrection', data: { original: view.media, tmdbId: selected.tmdbId } });
        if (!view.isCurrent()) return;
        if (!saved?.success) throw new Error(saved?.error || 'Could not remember this match');
      }
      this.mediaData = { ...view.media, title: selected.title, tmdbId: selected.tmdbId, mediaType: selected.mediaType, year: selected.year };
      const heading = view.elements.flyout?.querySelector('.seerr-title');
      if (heading) heading.textContent = `${selected.title}${selected.year ? ` (${selected.year})` : ''}`;
      await this.updateStatus();
    } finally {
      if (this._titlePickerController === controller) this._titlePickerController = null;
    }
  }

  /**
   * Handle a click on the watch button, which opens the configured media
   * server. Its label varies, so callers rely on the button class.
   */
  async handleWatchButtonClick() {
    this.log('Detected watch button click');
    const view = this.captureActionView();

    this.setUILoading(`Opening "${this.mediaData.title}"...`, 'Opening...');

    // Try to use cached watch URL first
    if (this.currentStatusData?.watchUrl) {
      this.log('Using cached watch URL');
      await this.openMediaServer(this.currentStatusData.watchUrl);
      return;
    }

    // Fall back to API call
    this.log('No cached watch URL, fetching from API');
    try {
      const statusData = await this.client.getMediaStatus(view.media);
      if (!view.isCurrent()) return;

      if (statusData.watchUrl) {
        await this.openMediaServer(statusData.watchUrl);
        return;
      }
    } catch (err) {
      this.error('Failed to get watch URL from API:', err);
    }

    if (!view.isCurrent()) return;
    // A watch click is not permission to create a request. A failed status
    // read or a missing playback URL must remain a read-only failure.
    this.currentStatusData = this.getErrorStatus(new Error('Watch URL unavailable. Retry the status lookup.'));
    this.updateUIFromStatus(this.currentStatusData);
    this.ui.createNotification('Watch URL Not Available', this.currentStatusData.message, 'warning', 4000);
  }

  /**
   * Open the configured media server in a new window. Seerr may be backed by
   * Plex, Jellyfin or Emby, so nothing here names a particular product.
   */
  async openMediaServer(watchUrl) {
    const view = this.captureActionView();
    if (!view.media || !view.isCurrent()) return;
    // Open while the click gesture is still active, not from a timer.
    const opened = window.open(watchUrl, '_blank');
    if (!opened) {
      this.ui.createNotification('Popup Blocked',
        `Allow popups for this site to open "${view.media.title}"`, 'warning', 4000);
    } else {
      this.ui.createNotification('Opening media server',
        `Opening "${view.media.title}"`, 'success', 3000);
    }
    this.deferViewAction(view, () => {
      if (this.currentStatusData) this.updateUIFromStatus(this.currentStatusData);
    }, 500);
  }

  /**
   * Handle regular request button click
   */
  async handleRequestButtonClick() {
    const view = this.captureActionView();
    try {
      let requestMedia = view.media;
      if (view.media.mediaType === 'tv') {
        this.setUILoading('Loading season availability…', 'Loading seasons…');
        const response = await this.client.sendMessage({ action: 'getSeasonOptions', data: view.media });
        if (!view.isCurrent()) return;
        if (!response?.success) throw new Error(response?.error || 'Could not load seasons');
        const controller = this._seasonPickerController = new AbortController();
        const seasons = await this.ui.chooseSeasons(response.data, { signal: controller.signal });
        if (this._seasonPickerController === controller) this._seasonPickerController = null;
        if (!view.isCurrent()) return;
        if (!seasons) { this.updateUIFromStatus(this.currentStatusData); return; }
        requestMedia = { ...view.media, tmdbId: response.data.tmdbId, seasons, seasonServer: response.data.server };
      }
      this.setUILoading(`Requesting "${this.mediaData.title}"...`, 'Requesting...');

      // Send once, only after the explicit season confirmation for TV.
      const result = await this.client.requestMedia(requestMedia);
      if (!view.isCurrent()) return;
      this.log('Request successful:', result);

      // Show success notification
      this.ui.createNotification(
          'Request Sent!',
          `${this.mediaData.title} has been added to your Seerr requests`,
          'success'
      );

      // Auto-close flyout after success
      if (this.uiTheme === 'flyout' && this.isFlyoutExpanded()) {
        this.deferViewAction(view, () => {
          view.elements.flyout.setExpanded(false, view.elements.flyout.contains(document.activeElement));
          this.log('Auto-closing flyout after successful request');
        }, 4000);
      }

      // Update status after delay
      this.deferViewAction(view, () => this.updateStatus().catch(err => this.error('Status refresh failed:', err)), 2000);

    } catch (err) {
      if (!view.isCurrent()) return;
      this.error('Request failed:', err);

      this.ui.createNotification(
          'Request Failed',
          err.message || 'Failed to send request to Seerr',
          'error'
      );

      // Reset UI after delay
      this.deferViewAction(view, () => this.updateStatus().catch(err => this.error('UI reset failed:', err)), 3000);
    }
  }

  async handleWatchlistClick() {
    if (this._watchlistAttempt) return;
    const view = this.captureActionView();
    if (!view.media) return;
    const attempt = this._watchlistAttempt = {};
    const button = view.elements.watchlistButton;
    if (button) button.disabled = true;
    try {
      await this.client.addToWatchlist(view.media);
      if (!view.isCurrent()) return;
      this.ui.createNotification('Added to Watchlist',
        `${view.media.title} has been added to your Seerr watchlist`, 'success');
    } catch (err) {
      if (view.isCurrent()) this.ui.createNotification('Watchlist Failed',
        err.message || 'Failed to add to watchlist', 'error');
    } finally {
      if (this._watchlistAttempt === attempt) {
        this._watchlistAttempt = null;
        if (view.isCurrent() && button) button.disabled = false;
      }
    }
  }

  async handlePlexWatchlistClick() {
    if (this._plexWatchlistAttempt) return;
    const view = this.captureActionView();
    this._statusGeneration = (this._statusGeneration || 0) + 1;
    if (!this.mediaData) {
      this.ui.createNotification('Error', 'Could not extract media information', 'error');
      return;
    }
    const attempt = this._plexWatchlistAttempt = {};
    const plexButton = view.elements.plexButton;
    const label = plexButton ? plexButton.querySelector('span') : null;
    const original = label ? label.textContent : null;
    try {
      if (label) label.textContent = 'Adding to Plex…';
      if (plexButton) plexButton.disabled = true;
      const result = await this.client.plexAddToWatchlist(view.media);
      if (!view.isCurrent()) return;
      this.ui.createNotification(
        result && result.already ? 'Already on Plex Watchlist' : 'Added to Plex Watchlist',
        result && result.already
          ? `${this.mediaData.title} is already on your Plex Watchlist`
          : `${this.mediaData.title} has been added to your Plex Watchlist`,
        'success'
      );
      if (label) label.textContent = result && result.already ? 'On Plex Watchlist' : 'Added to Plex ✓';
    } catch (err) {
      if (!view.isCurrent()) return;
      this.ui.createNotification(
        'Plex Watchlist Failed',
        err.message || 'Failed to add to Plex Watchlist',
        'error'
      );
      if (label && original) label.textContent = original;
    } finally {
      if (this._plexWatchlistAttempt === attempt) {
        this._plexWatchlistAttempt = null;
        if (view.isCurrent() && plexButton) plexButton.disabled = false;
      }
    }
  }

  /**
   * Set UI to loading state
   */
  setUILoading(message, buttonText) {
    const loadingState = {
      status: 'loading',
      message,
      buttonText,
      disabled: true
    };

    if (this.uiTheme === 'flyout') {
      this.ui.updateFlyoutStatus(this.uiElements, loadingState);
    } else {
      this.ui.updateButtonStatus(this.uiElements.button, loadingState);
    }
  }

  /**
   * Update UI from cached status data
   */
  updateUIFromStatus(statusData) {
    if (this.uiTheme === 'flyout') {
      this.ui.updateFlyoutStatus(this.uiElements, statusData, { plexConfigured: this.plexConfigured });
    } else {
      this.ui.updateButtonStatus(this.uiElements.button, statusData);
    }
  }

  /**
   * Get error status for UI updates
   */
  getErrorStatus(error) {
    return {
      status: 'error',
      buttonText: 'Retry status',
      buttonClass: 'error',
      message: error.message || 'Status lookup failed',
      action: 'retryStatus'
    };
  }

  /**
   * Setup debug functions on window object
   */
  setupDebugFunctions() {
    const self = this;
    if (!window.seerr_debug) {
      window.seerr_debug = {};
    }

    window.seerr_debug[this.siteName.toLowerCase()] = {
      updateStatus: () => this.updateStatus(),
      testAPI: () => this.client.debugAPI(),
      // A getter, not a snapshot: this object is built once, but mediaData is
      // replaced on every SPA navigation.
      get mediaData() { return self.mediaData; },
      testExtensionConnection: () => this.client.testExtensionConnection(),
      testServerConnection: () => this.client.testServerConnection(),
      debugSearch: (title, mediaType) => this.client.debugSearch(title || this.mediaData?.title, mediaType || this.mediaData?.mediaType),
      getStatus: () => this.client.getMediaStatus(this.mediaData),
      expandFlyout: () => {
        if (this.uiElements.flyout) {
          this.uiElements.flyout.setExpanded(true);
        }
      },
      collapseFlyout: () => {
        if (this.uiElements.flyout) {
          this.uiElements.flyout.setExpanded(false);
        }
      },
      testTabIcons: () => {
        if (!this.uiElements.tab) {
          console.log('No tab found for icon testing');
          return;
        }
        console.log('Testing all tab icon states...');
        const states = ['checking', 'available', 'pending', 'downloading', 'ready', 'error'];
        let i = 0;
        const cycle = () => {
          this.ui.updateTabIcon(this.uiElements.tab, states[i]);
          console.log('Tab icon:', states[i]);
          i = (i + 1) % states.length;
          if (i !== 0) setTimeout(cycle, 2000);
        };
        cycle();
      },
      forceTabStatus: (status) => {
        if (this.uiElements.tab) {
          this.ui.updateTabIcon(this.uiElements.tab, status || 'available');
          console.log('Forced tab icon to:', status || 'available');
        }
      }
    };

    this.log('Debug functions added to window.seerr_debug.' + this.siteName.toLowerCase());
  }

  /**
   * Utility method for child classes to create standardized media data
   */
  createMediaData(extractedData) {
    return this.extractor.createMediaData(extractedData, this.siteName.toLowerCase());
  }

  /**
   * Utility method for finding insertion points with fallback options
   */
  findInsertionPoint(selectors, context = 'insertion point') {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      this.log(`Trying ${context} selector "${selector}":`, element ? 'found' : 'not found');
      if (element) {
        this.log(`Using ${context}:`, selector);
        return element;
      }
    }
    this.log(`No ${context} found with selectors:`, selectors);
    return null;
  }

  /**
   * Setup Single Page Application (SPA) navigation detection
   * Detects URL changes without page refreshes (like React Router)
   */
  setupNavigationDetection() {
    this.log('Setting up SPA navigation detection');

    const handleNavigation = () => {
      const newUrl = window.location.href;
      if (newUrl !== this.currentUrl) {
        this.log('SPA navigation detected:', this.currentUrl, '->', newUrl);
        this.currentUrl = newUrl;
        this.handleNavigationChange();
      }
    };

    // Method 1: Override pushState and replaceState (most reliable).
    // Only the patch is skipped when another instance already installed one;
    // methods 2 and 3 below are per-instance and must still be set up.
    if (history.pushState.__seerrPatched) {
      this.log('history.pushState already patched, skipping the patch only');
    } else {
      const originalPushState = history.pushState;
      const originalReplaceState = history.replaceState;

      const wrappedPushState = function(...args) {
        originalPushState.apply(history, args);
        setTimeout(handleNavigation, 100); // Small delay for React to update DOM
      };
      wrappedPushState.__seerrPatched = true;
      history.pushState = wrappedPushState;

      const wrappedReplaceState = function(...args) {
        originalReplaceState.apply(history, args);
        setTimeout(handleNavigation, 100);
      };
      wrappedReplaceState.__seerrPatched = true;
      history.replaceState = wrappedReplaceState;

      this._originalPushState = originalPushState;
      this._originalReplaceState = originalReplaceState;
    }

    // Method 2: Listen for popstate (back/forward buttons)
    this._popstateListener = () => setTimeout(handleNavigation, 100);
    window.addEventListener('popstate', this._popstateListener);

    // Method 3: Polling as fallback (for edge cases)
    this.resumeNavigationPolling();
  }

  /**
   * Handle navigation change in SPAs
   */
  async handleNavigationChange() {
    this.log('Handling navigation change to:', this.currentUrl);

    if (this.destroyed) return;

    // Navigation always retires the old title, even if its panel is open.
    this.cleanupUI();
    const generation = this._extractionGeneration;
    const pageUrl = window.location.href;

    // Wait a bit for the new page content to load
    await new Promise(resolve => setTimeout(resolve, 500));
    if (this.destroyed || generation !== this._extractionGeneration || window.location.href !== pageUrl) return;

    // Re-extract and setup for the new page
    await this.extractAndSetup();
    if (this.destroyed) return;

    // Retry after delay for dynamic content
    this.deferRetry(() => {
      this.log('Retry extraction after navigation');
      this.extractAndSetup().catch(err => this.error('Nav retry extraction failed:', err));
    }, this.retryDelay);
  }

  /**
   * Clean up existing UI elements
   */
  cleanupUI() {
    this.log('Cleaning up existing UI');
    this._titlePickerController?.abort();
    this._titlePickerController = null;
    this._seasonPickerController?.abort();
    this._seasonPickerController = null;
    this._extractionGeneration = (this._extractionGeneration || 0) + 1;
    this._statusGeneration = (this._statusGeneration || 0) + 1;

    // A new page supersedes every retry scheduled for the old one.
    this.clearPendingRetries();

    // Remove the old title's flyout regardless of its expansion state
    if (this.hasFlyout()) {
      this.uiElements.flyout.parentNode.removeChild(this.uiElements.flyout);
    }

    // Remove button if it exists
    if (this.uiElements.button && this.uiElements.button.parentNode) {
      this.uiElements.button.parentNode.removeChild(this.uiElements.button);
    }

    // Clear references
    this.uiElements = {};
    this.mediaData = null;
    this.currentStatusData = null;
    // A request in flight belongs to the old page: navigating mid-request
    // must not wedge the new page's button shut forever.
    this._requestInFlight = false;
    this._requestAttempt = null;
    this._watchlistAttempt = null;
    this._plexWatchlistAttempt = null;
  }

  /**
   * Cleanup when extension is unloaded
   */
  destroy() {
    if (this.navigationListener) {
      clearInterval(this.navigationListener);
      this.navigationListener = null;
    }
    if (this._popstateListener) {
      window.removeEventListener('popstate', this._popstateListener);
      this._popstateListener = null;
    }
    if (this._pagehideListener) {
      window.removeEventListener('pagehide', this._pagehideListener);
      window.removeEventListener('pageshow', this._pageshowListener);
      this._pagehideListener = null;
      this._pageshowListener = null;
      this._lifecycleBound = false;
    }
    if (this._originalPushState && history.pushState.__seerrPatched) {
      history.pushState = this._originalPushState;
    }
    if (this._originalReplaceState && history.replaceState.__seerrPatched) {
      history.replaceState = this._originalReplaceState;
    }
    this._originalPushState = null;
    this._originalReplaceState = null;
    this.destroyed = true;
    if (window.seerr_debug) {
      delete window.seerr_debug[this.siteName.toLowerCase()];
    }
    this.cleanupUI();
  }
}

// Export for use in content scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BaseIntegration;
} else if (typeof window !== 'undefined') {
  window.BaseIntegration = BaseIntegration;
}
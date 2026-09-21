// Shared UI Components Library
// Reusable UI elements for all site integrations

class UIComponents {
  constructor(options = {}) {
    this.debug = options.debug || false;
    this.siteName = options.siteName || 'UNKNOWN';
    this.theme = options.theme || 'default';
  }

  log(...args) {
    if (this.debug) console.log(`🎨 [${this.siteName}]`, ...args);
  }

  chooseSeasons(options, settings) {
    return window.chooseSeerrSeasons(options, settings);
  }

  // Explicit selection only; opening or cancelling this picker never writes.
  chooseTitle(candidates, { title, signal } = {}) {
    if (signal?.aborted) return Promise.resolve(null);
    return new Promise(resolve => {
      const previousFocus = document.activeElement;
      const backdrop = this.el('div', { className: 'seerr-title-picker' });
      backdrop.style.cssText = 'box-sizing:border-box;position:fixed;inset:0;background:#0009;z-index:2147483647;display:grid;place-items:center;padding:20px;color:#f9fafb;font:14px system-ui;';
      const dialog = this.el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Choose matching title', tabindex: '-1' });
      dialog.style.cssText = 'box-sizing:border-box;min-width:0;overflow-wrap:anywhere;background:#171b25;color:#f9fafb;border:1px solid #64748b;border-radius:12px;padding:20px;max-width:540px;width:100%;max-height:min(85vh, calc(100dvh - 40px));overflow:auto;';
      const heading = this.el('h2', { textContent: 'Choose matching title' });
      const explanation = this.el('p', { textContent: `Select the correct match for “${title || ''}”. This checks availability; it does not send a request.` });
      dialog.append(heading, explanation);
      const remember = this.el('input', { type: 'checkbox' });
      const rememberLabel = this.el('label', {}, [remember, this.el('span', { textContent: ' Remember this match on this device' })]);
      const finish = value => {
        signal?.removeEventListener('abort', abort);
        backdrop.remove();
        if (previousFocus?.isConnected) previousFocus.focus();
        resolve(value);
      };
      const abort = () => finish(null);
      signal?.addEventListener('abort', abort, { once: true });
      const list = this.el('div');
      for (const candidate of candidates) {
        const button = this.el('button', { type: 'button', className: 'seerr-title-choice' });
        button.style.cssText = 'box-sizing:border-box;white-space:normal;overflow-wrap:anywhere;font:inherit;display:block;width:100%;padding:12px;margin:10px 0;text-align:left;background:#263244;color:#fff;border:1px solid #94a3b8;border-radius:6px;cursor:pointer;';
        button.append(this.el('strong', { textContent: `${candidate.title} (${candidate.year || 'Year unknown'}) — ${candidate.mediaType === 'tv' ? 'TV' : 'Movie'}` }));
        button.append(this.el('p', { textContent: candidate.overview || `TMDB ${candidate.tmdbId}` }));
        button.addEventListener('click', () => finish({ ...candidate, rememberChoice: remember.checked }), { once: true });
        list.appendChild(button);
      }
      if (!candidates.length) list.appendChild(this.el('p', { textContent: 'No verified matches found. Search directly in Seerr to choose a different title.' }));
      const cancel = this.el('button', { type: 'button', textContent: 'Cancel' });
      cancel.style.cssText = 'font:inherit;min-height:44px;padding:8px 16px;margin-top:12px;background:#263244;color:#fff;border:1px solid #94a3b8;border-radius:6px;cursor:pointer;';
      cancel.addEventListener('click', abort);
      dialog.append(list, rememberLabel, cancel); backdrop.appendChild(dialog); document.body.appendChild(backdrop);
      dialog.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); abort(); }
        if (event.key === 'Tab') {
          const controls = [...dialog.querySelectorAll('button,input')];
          const index = controls.indexOf(document.activeElement);
          if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1).focus(); }
          else if (!event.shiftKey && (index === controls.length - 1 || index < 0)) { event.preventDefault(); controls[0].focus(); }
        }
      });
      cancel.focus();
    });
  }

  /**
   * Helper to create DOM elements with attributes and children
   */
  el(tag, props = {}, children = []) {
    const element = document.createElement(tag);
    Object.entries(props).forEach(([key, value]) => {
      if (key === 'className') element.className = value;
      else if (key === 'textContent') element.textContent = value;
      else element.setAttribute(key, value);
    });
    children.forEach(child => child && element.appendChild(child));
    return element;
  }

  /**
   * Helper to create SVG icons
   */
  svg(path, options = {}) {
    const size = options.size || 16;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', options.className || 'seerr-button-icon');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'currentColor');

    const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathEl.setAttribute('d', path);
    if (options.pathClass) pathEl.setAttribute('class', options.pathClass);
    
    svg.appendChild(pathEl);
    return svg;
  }

  // Toasts stack in a fixed corner column. Without the container every toast
  // sat at the same coordinates and only the topmost was ever visible.
  notificationStack() { return window.SeerrNotifications.notificationStack(); }
  createNotification(...args) { return window.SeerrNotifications.createNotification(...args); }
  removeNotification(notification) { return window.SeerrNotifications.removeNotification(notification); }

  createRequestButton(options = {}) {
    const button = this.el('button', { type: 'button', className: 'seerr-request-button request' }, [
      this.svg('M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z'),
      this.el('span', { textContent: options.text || 'Request on Seerr' })
    ]);

    if (options.disabled) button.disabled = true;
    this.log('Request button created');
    return button;
  }

  updateButtonStatus(button, statusData) {
    if (!button) return;

    button.classList.remove('loading', 'success', 'error', 'pending', 'available', 'downloading', 'watch', 'request', 'partial');
    button.classList.add(statusData.buttonClass || 'request');
    
    button.disabled = statusData.disabled || 
                     ['pending', 'requested', 'downloading'].includes(statusData.status);

    const iconPath = this.getIconPath(statusData.status);
    
    button.innerHTML = '';
    button.appendChild(this.svg(iconPath));
    button.appendChild(this.el('span', { textContent: statusData.buttonText || 'Request on Seerr' }));

    this.log('Button status updated:', statusData.status);
  }

  getIconPath(status) {
    switch (status) {
      case 'pending':
      case 'requested':
        return 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z';
      case 'downloading':
        return 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm3 11l-4 4-4-4h3V9h2v4h3z';
      case 'available':
        return 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z';
      case 'ready':
      case 'available_watch':
      case 'partial':
        return 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z';
      case 'error':
        return 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm3.5 6L12 10.5 8.5 8 7 9.5 10.5 12 7 14.5 8.5 16 12 13.5 15.5 16 17 14.5 13.5 12 17 9.5 15.5 8z';
      default:
        return 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z';
    }
  }

  /**
   * Whether the page we are injected into is dark, judged by its own
   * background rather than by prefers-color-scheme: IMDb, Letterboxd, Trakt
   * and Metacritic are dark whatever the visitor's system is set to.
   * Falls back to the system preference when the page does not say.
   */
  detectHostTheme() {
    for (const element of [document.body, document.documentElement]) {
      const luminance = this.backgroundLuminance(element);
      if (luminance !== null) return luminance < 0.42 ? 'dark' : 'light';
    }
    try {
      return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light';
    } catch (_) {
      return 'light';
    }
  }

  // Perceived luminance of an element's background, or null when it is
  // transparent or unreadable and the answer should come from elsewhere.
  backgroundLuminance(element) {
    if (!element || typeof window.getComputedStyle !== 'function') return null;
    const colour = window.getComputedStyle(element).backgroundColor;
    const parts = /rgba?\(([^)]+)\)/.exec(colour || '');
    if (!parts) return null;
    const [r, g, b, a = '1'] = parts[1].split(',').map(part => parseFloat(part));
    if ([r, g, b].some(Number.isNaN) || parseFloat(a) === 0) return null;
    // Rec. 601 luma: cheap, and close enough to decide light from dark.
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }

  createFlyout() {
    const flyoutId = `seerr-flyout-${this.siteName.toLowerCase()}`;
    document.getElementById(flyoutId)?.remove();

    const tab = this.el('button', { className: 'seerr-tab', type: 'button', 'aria-expanded': 'false', 'aria-controls': `${flyoutId}-panel`, 'aria-label': 'Open Super Seerr' }, [
      this.svg('M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z', {
        size: 24,
        className: 'seerr-tab-icon seerr-connection-status checking',
        pathClass: 'seerr-icon-path'
      }),
      this.el('span', { className: 'seerr-tab-text', textContent: 'Super Seerr' })
    ]);

    const panel = this.el('div', { className: 'seerr-panel', id: `${flyoutId}-panel`, role: 'region', 'aria-label': 'Super Seerr title actions', tabindex: '-1', 'aria-hidden': 'true', inert: '' });
    const flyout = this.el('div', {
      id: flyoutId,
      className: `seerr-flyout collapsed seerr-theme-${this.detectHostTheme()}`
    }, [tab, panel]);

    flyout.setExpanded = (expanded, moveFocus = true) => {
      flyout.classList.toggle('collapsed', !expanded);
      flyout.classList.toggle('expanded', expanded);
      tab.setAttribute('aria-expanded', String(expanded));
      tab.setAttribute('aria-label', expanded ? 'Close Super Seerr' : 'Open Super Seerr');
      panel.setAttribute('aria-hidden', String(!expanded));
      panel.toggleAttribute('inert', !expanded);
      if (moveFocus) (expanded ? panel : tab).focus();
    };
    tab.addEventListener('click', () => flyout.setExpanded(!flyout.classList.contains('expanded')));
    flyout.addEventListener('keydown', event => {
      if (event.key === 'Escape' && flyout.classList.contains('expanded')) {
        event.preventDefault();
        event.stopPropagation();
        flyout.setExpanded(false);
      }
    });
    const close = this.el('button', { type: 'button', className: 'seerr-panel-close', 'aria-label': 'Close Super Seerr', textContent: 'Close' });
    close.addEventListener('click', () => flyout.setExpanded(false));
    panel.appendChild(close);

    this.log('Flyout created');
    return { flyout, tab, panel };
  }

  createFlyoutContent(mediaData, panel) {
    const statusIcon = this.el('div', { className: 'seerr-status-icon loading' });
    const statusText = this.el('span', { className: 'seerr-status-text', role: 'status', 'aria-live': 'polite', textContent: 'Connecting to Seerr...' });
    
    const statusSection = this.el('div', { className: 'seerr-status-section' }, [
      this.el('div', { className: 'seerr-media-info' }, [
        this.el('h3', { className: 'seerr-title', textContent: mediaData.title || 'Unknown Title' }),
        this.el('p', { className: 'seerr-year', textContent: `${mediaData.year || 'Unknown Year'} • ${mediaData.mediaType === 'tv' ? 'TV Series' : 'Movie'}` })
      ]),
      this.el('div', { className: 'seerr-status-indicator' }, [statusIcon, statusText])
    ]);

    const button = this.el('button', { type: 'button', className: 'seerr-action-button loading', disabled: 'true' }, [
      this.svg('M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z', { size: 20 }),
      this.el('span', { textContent: 'Connecting to Seerr...' })
    ]);

    panel.appendChild(statusSection);
    panel.appendChild(button);
    const seasonButton = mediaData.mediaType === 'tv'
      ? this.el('button', { type: 'button', className: 'seerr-watchlist-button seerr-seasons-button', textContent: 'Choose TV seasons' }) : null;
    if (seasonButton) panel.appendChild(seasonButton);

    const watchlistButton = this.el('button', {
      type: 'button', className: 'seerr-watchlist-button',
      style: 'display:none'
    }, [
      this.svg('M17 12h-5v5h-2v-5H5v-2h5V5h2v5h5v2z', { size: 18 }),
      this.el('span', { textContent: 'Add to Watchlist' })
    ]);
    panel.appendChild(watchlistButton);

    // True Plex Watchlist: visible whenever a Plex token is configured,
    // including for available titles where the Seerr button hides.
    const plexButton = this.el('button', {
      type: 'button', className: 'seerr-plex-button',
      style: 'display:none'
    }, [
      this.svg('M17 12h-5v5h-2v-5H5v-2h5V5h2v5h5v2z', { size: 18 }),
      this.el('span', { textContent: 'Add to Plex Watchlist' })
    ]);
    panel.appendChild(plexButton);

    return { statusSection, button, statusIcon, statusText, watchlistButton, plexButton, seasonButton };
  }

  updateFlyoutStatus(elements, statusData, options = {}) {
    const { statusIcon, statusText, button } = elements;
    
    if (statusIcon && statusText) {
      statusIcon.className = `seerr-status-icon ${statusData.status || 'loading'}`;
      
      let message = statusData.message || 'Connecting to Seerr...';
      if (statusData.monitoring?.message) {
        message = `${statusData.monitoring.indicator} ${statusData.monitoring.message}`;
      }
      statusText.textContent = message;
    }
    
    if (button) this.updateButtonStatus(button, statusData);

    const showWatchlist = !statusData.action && (statusData.status === 'available' || statusData.buttonClass === 'request');
    if (elements.watchlistButton) {
      elements.watchlistButton.style.display = showWatchlist ? 'flex' : 'none';
    }
    this.updatePlexWatchlistStatus(elements, statusData, options);
  }

  updatePlexWatchlistStatus(elements, statusData, options = {}) {
    // Plex is independent of Seerr status: an available title is exactly what
    // the user wants to save to Plex. Only the token gates it, never the
    // request state. Error/loading states hide it to avoid a dead click.
    const plexReady = options.plexConfigured === true;
    const plexBlocked = ['loading', 'error'].includes(statusData.status) || !!statusData.action;
    if (elements.plexButton) {
      elements.plexButton.style.display = plexReady && !plexBlocked ? 'flex' : 'none';
      // Already there renders as state, not an action. Unknown keeps Add.
      const plexOn = options.plexOnWatchlist === true;
      const span = elements.plexButton.querySelector('span');
      if (span) span.textContent = plexOn ? 'On Plex Watchlist ✓' : 'Add to Plex Watchlist';
      elements.plexButton.disabled = plexOn;
    }
  }

  updateTabIcon(tab, status, statusData = null) {
    const iconElement = tab.querySelector('.seerr-connection-status');
    const pathElement = tab.querySelector('.seerr-icon-path');
    
    if (!iconElement || !pathElement) return;

    const iconPath = this.getIconPath(status);
    const statusClasses = {
      checking: 'checking',
      loading: 'checking',
      available: 'available',
      pending: 'pending',
      requested: 'pending',
      downloading: 'downloading',
      ready: 'ready',
      available_watch: 'ready',
      partial: 'partial',
      error: 'error'
    };

    iconElement.setAttribute('class', `seerr-tab-icon seerr-connection-status ${statusClasses[status] || 'error'}`);
    pathElement.setAttribute('d', iconPath);
    
    if (statusData) {
      let tooltip = statusData.message || `Seerr - ${status}`;
      if (statusData.monitoring?.message) {
        tooltip += ` ${statusData.monitoring.indicator} ${statusData.monitoring.message}`;
      }
      tab.title = tooltip;
    }
  }

  injectStyles(additionalCSS = '') {
    const styleId = `seerr-styles-${this.siteName.toLowerCase()}`;
    if (document.getElementById(styleId)) return;

    const style = this.el('style', { id: styleId, textContent: this.getSharedCSS() + additionalCSS });
    document.head.appendChild(style);
  }

  /**
   * Get shared CSS for all UI components
   * @returns {string} CSS string
   */
  getSharedCSS() {
    return `
      /* Seerr Shared UI Components - Default Purple Theme */
      .seerr-request-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        font-weight: 500;
        font-size: 0.875rem;
        padding: 0.5rem 1rem;
        border: 2px solid #8b5cf6;
        border-radius: 0.375rem;
        cursor: pointer;
        text-decoration: none;
        white-space: nowrap;
        min-width: 120px;
        position: relative;
        z-index: 9999;
        transition: all 0.15s ease-in-out;
        outline: none;
        background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
        color: white;
      }

      .seerr-request-button:hover:not(:disabled) {
        background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%);
        border-color: #7c3aed;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(139, 92, 246, 0.4);
      }

      .seerr-request-button:disabled {
        background: #6b7280;
        border-color: #6b7280;
        color: #d1d5db;
        cursor: not-allowed;
        opacity: 0.6;
      }

      .seerr-request-button.pending {
        background: rgba(245, 158, 11, 0.8);
        border-color: #f59e0b;
      }

      .seerr-request-button.downloading {
        background: rgba(59, 130, 246, 0.8);
        border-color: #3b82f6;
      }

      .seerr-request-button.available {
        background: rgba(16, 185, 129, 0.8);
        border-color: #10b981;
      }

      .seerr-request-button.watch {
        background: rgba(16, 185, 129, 0.9);
        border-color: #10b981;
        color: white;
      }

      .seerr-request-button.watch:hover:not(:disabled) {
        background: rgba(5, 150, 105, 1);
        border-color: #059669;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
      }

      .seerr-request-button.error {
        background: rgba(239, 68, 68, 0.8);
        border-color: #ef4444;
      }

      .seerr-button-icon {
        width: 1rem;
        height: 1rem;
        margin-right: 0.5rem;
        fill: currentColor;
        flex-shrink: 0;
      }

      /* Notifications */
      /* Notifications stack in a fixed corner column so a burst stays
         readable instead of piling every toast on the same spot. */
      .seerr-notification-stack {
        position: fixed;
        top: 1.25rem;
        right: 1.25rem;
        z-index: 10000;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        align-items: flex-end;
        pointer-events: none;
        max-height: calc(100dvh - 40px);
        max-width: calc(100vw - 40px);
        overflow-y: auto;
      }

      .seerr-notification-stack > * {
        pointer-events: auto;
      }

      .seerr-notification {
        position: static;
        background: #1f2937;
        border: 1px solid #374151;
        border-radius: 0.5rem;
        padding: 1rem;
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.25);
        z-index: 10000;
        box-sizing: border-box;
        min-width: 0;
        width: min(360px, calc(100vw - 40px));
        max-height: calc(100dvh - 40px);
        overflow: auto;
        overflow-wrap: anywhere;
        flex-shrink: 0;
        animation: slideIn 0.3s ease;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        color: #f9fafb;
        opacity: 1;
        transform: translateX(0);
        transition: all 0.3s ease;
      }

      .seerr-notification.success { border-left: 4px solid #10b981; }
      .seerr-notification.error { border-left: 4px solid #ef4444; }
      .seerr-notification.warning { border-left: 4px solid #f59e0b; }
      .seerr-notification.info { border-left: 4px solid #3b82f6; }

      .seerr-notification-title {
        font-weight: 600;
        margin-bottom: 0.5rem;
        font-size: 0.875rem;
      }

      .seerr-notification-message {
        font-size: 0.8rem;
        color: #d1d5db;
        line-height: 1.4;
      }

      .seerr-notification-close {
        position: absolute;
        top: 0.5rem;
        right: 0.5rem;
        background: none;
        border: none;
        color: #9ca3af;
        cursor: pointer;
        font-size: 1.2rem;
        line-height: 1;
        padding: 0;
        width: 1.5rem;
        height: 1.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .seerr-notification-close:hover {
        color: #f9fafb;
      }

      @keyframes slideIn {
        from {
          opacity: 0;
          transform: translateX(100%);
        }
        to {
          opacity: 1;
          transform: translateX(0);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .seerr-flyout, .seerr-flyout *, .seerr-notification {
          animation: none !important;
          transition: none !important;
        }
      }

      /* Flyout Components (imported from RT styles) */
      .seerr-flyout {
        position: fixed;
        right: 0;
        top: 50%;
        transform: translateY(-50%);
        z-index: 9999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        max-width: calc(100vw - 68px);
        transform: translateY(-50%) translateX(100%);
      }

      .seerr-flyout.expanded {
        transform: translateY(-50%) translateX(0);
      }

      /* Default Seerr brand theme - purple/violet gradient */
      .seerr-tab {
        position: absolute;
        left: -60px;
        top: 50%;
        transform: translateY(-50%);
        width: 60px;
        height: 120px;
        background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
        border: 2px solid #8b5cf6;
        border-radius: 8px 0 0 8px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        box-shadow: -2px 0 12px rgba(139, 92, 246, 0.3);
        transition: all 0.2s ease;
        color: white;
        user-select: none;
      }

      .seerr-tab { padding: 0; font: inherit; }
      .seerr-flyout button:focus-visible, .seerr-panel:focus-visible {
        outline: 3px solid #f59e0b;
        outline-offset: 3px;
      }
      .seerr-panel-close {
        display: block; margin: 8px 8px 10px auto; padding: 8px 12px; min-height: 36px;
        border: 1px solid currentColor; border-radius: 4px;
        background: transparent; color: inherit; cursor: pointer;
      }
      .seerr-tab:hover {
        background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%);
        border-color: #7c3aed;
        transform: translateY(-50%) translateX(-4px);
        box-shadow: -6px 0 16px rgba(139, 92, 246, 0.4);
      }

      .seerr-tab-icon {
        margin-bottom: 4px;
        opacity: 0.9;
      }

      .seerr-tab-text {
        font-size: 11px;
        font-weight: 600;
        writing-mode: vertical-rl;
        text-orientation: mixed;
        letter-spacing: 0.5px;
        text-transform: uppercase;
      }

      .seerr-flyout, .seerr-flyout * { box-sizing: border-box; }
      .seerr-panel {
        color: #1a202c;
        width: min(320px, calc(100vw - 68px));
        max-height: calc(100dvh - 24px);
        overflow-wrap: anywhere;
        background: white;
        border-radius: 8px 0 0 8px;
        box-shadow: -4px 0 20px rgba(0, 0, 0, 0.15);
        border: 1px solid #e2e8f0;
        overflow-y: auto;
      }

      .seerr-status-section {
        padding: 20px;
        border-bottom: 1px solid #f1f5f9;
      }

      .seerr-media-info {
        margin-bottom: 16px;
      }

      .seerr-title {
        font-size: 18px;
        font-weight: 700;
        color: #1a202c;
        margin: 0 0 4px 0;
        line-height: 1.3;
      }

      .seerr-year {
        font-size: 14px;
        color: #64748b;
        margin: 0;
        font-weight: 500;
      }

      .seerr-status-indicator {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .seerr-status-icon {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        position: relative;
      }

      .seerr-status-icon.loading {
        background: #cbd5e0;
        animation: pulse 2s infinite;
      }

      .seerr-status-icon.available {
        background: #10b981;
      }

      .seerr-status-icon.pending {
        background: #f59e0b;
      }

      .seerr-status-icon.downloading {
        background: #3b82f6;
        animation: pulse 1.5s infinite;
      }

      .seerr-status-icon.partial {
        background: #10b981; /* Green since content is partially available */
      }

      .seerr-status-icon.error {
        background: #ef4444;
      }

      .seerr-status-text {
        font-size: 14px;
        color: #475569;
        font-weight: 500;
      }

      /* Default Seerr brand theme for action button */
      .seerr-action-button {
        width: 100%;
        padding: 14px 20px;
        background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
        border: 2px solid #8b5cf6;
        color: white;
        border-radius: 0 0 0 8px;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        transition: all 0.2s ease;
        outline: none;
      }

      .seerr-action-button:hover:not(:disabled) {
        background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%);
        border-color: #7c3aed;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(139, 92, 246, 0.4);
      }

      .seerr-action-button:disabled {
        background: #9ca3af;
        cursor: not-allowed;
        opacity: 0.7;
      }

      .seerr-action-button.watch {
        background: linear-gradient(135deg, #10b981 0%, #059669 100%);
        border-color: #10b981;
      }

      .seerr-action-button.watch:hover:not(:disabled) {
        background: linear-gradient(135deg, #059669 0%, #047857 100%);
        border-color: #059669;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
      }

      /* Tab status colors */
      .seerr-connection-status.checking {
        color: #cbd5e0 !important;
        animation: pulse 2s infinite;
      }

      .seerr-connection-status.available {
        color: #10b981 !important;
      }

      .seerr-connection-status.pending {
        color: #f59e0b !important;
      }

      .seerr-connection-status.downloading {
        color: #3b82f6 !important;
        animation: pulse 1.5s infinite;
      }

      .seerr-connection-status.ready {
        color: #10b981 !important;
      }

      .seerr-connection-status.partial {
        color: #10b981 !important; /* Green like ready/available since content is available */
      }

      .seerr-connection-status.error {
        color: #ef4444 !important;
      }

      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }

      /* Theme follows the page we are injected into, not the operating
         system: these sites are dark whatever the visitor prefers. */
      .seerr-theme-dark .seerr-panel {
        color: #f9fafb;
        background: #1f2937;
        border-color: #374151;
      }
        
      .seerr-theme-dark .seerr-title {
        color: #f9fafb;
      }
        
      .seerr-theme-dark .seerr-year {
        color: #9ca3af;
      }
        
      .seerr-theme-dark .seerr-status-text {
        color: #d1d5db;
      }
        
      .seerr-theme-dark .seerr-status-section {
        border-bottom-color: #374151;
      }

      .seerr-watchlist-button {
        width: 100%;
        padding: 10px 20px;
        background: transparent;
        border: 2px solid #8b5cf6;
        color: #8b5cf6;
        border-radius: 0 0 0 8px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        transition: all 0.2s ease;
        outline: none;
      }

      .seerr-watchlist-button:hover:not(:disabled) {
        background: rgba(139, 92, 246, 0.1);
        transform: translateY(-1px);
      }

      .seerr-plex-button {
        width: 100%;
        padding: 10px 20px;
        background: transparent;
        border: 2px solid #e5a00d;
        color: #e5a00d;
        border-radius: 0 0 0 8px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        transition: all 0.2s ease;
        outline: none;
      }

      .seerr-plex-button:hover:not(:disabled) {
        background: rgba(229, 160, 13, 0.12);
        transform: translateY(-1px);
      }

      .seerr-plex-button:disabled {
        opacity: 0.75;
        cursor: default;
      }

      .seerr-in-library-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: #10b981;
        color: white;
        font-size: 11px;
        font-weight: 600;
        padding: 2px 8px;
        border-radius: 9999px;
        margin-left: 8px;
        vertical-align: middle;
      }
    `;
  }

  showInLibraryBadge(mediaInfoElement) {
    const badgeId = 'seerr-in-library-badge';
    if (document.getElementById(badgeId)) return;

    const checkSvg = this.svg(
      'M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z',
      { size: 12, className: 'seerr-badge-icon' }
    );

    const badge = this.el('span', { id: badgeId, className: 'seerr-in-library-badge' }, [
      checkSvg,
      this.el('span', { textContent: 'In Library' })
    ]);

    const titleEl = mediaInfoElement.querySelector('.seerr-title');
    if (titleEl) {
      titleEl.appendChild(badge);
    } else {
      mediaInfoElement.appendChild(badge);
    }
  }

  hideInLibraryBadge(mediaInfoElement) {
    const badge = document.getElementById('seerr-in-library-badge');
    if (badge) badge.remove();
  }
}

// Export for use in content scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = UIComponents;
} else if (typeof window !== 'undefined') {
  window.UIComponents = UIComponents;
}
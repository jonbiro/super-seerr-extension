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

  createNotification(title, message, type = 'info', duration = 5000) {
    const closeBtn = this.el('button', { className: 'seerr-notification-close', textContent: '×' });
    const notification = this.el('div', { className: `seerr-notification ${type}` }, [
      this.el('div', { className: 'seerr-notification-title', textContent: title }),
      this.el('div', { className: 'seerr-notification-message', textContent: message }),
      closeBtn
    ]);

    closeBtn.addEventListener('click', () => this.removeNotification(notification));

    if (duration > 0) {
      setTimeout(() => this.removeNotification(notification), duration);
    }

    document.body.appendChild(notification);
    this.log('Notification created:', type, title);
    return notification;
  }

  removeNotification(notification) {
    if (notification?.parentNode) {
      notification.style.opacity = '0';
      notification.style.transform = 'translateX(100%)';
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }
  }

  createRequestButton(options = {}) {
    const button = this.el('button', { className: 'seerr-request-button request' }, [
      this.svg('M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z'),
      this.el('span', { textContent: options.text || 'Request on Seerr' })
    ]);

    if (options.disabled) button.disabled = true;
    this.log('Request button created');
    return button;
  }

  updateButtonStatus(button, statusData) {
    if (!button) return;

    button.classList.remove('loading', 'success', 'error', 'pending', 'available', 'downloading');
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

  createFlyout() {
    const flyoutId = `seerr-flyout-${this.siteName.toLowerCase()}`;
    document.getElementById(flyoutId)?.remove();

    const tab = this.el('div', { className: 'seerr-tab' }, [
      this.svg('M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z', {
        size: 24,
        className: 'seerr-tab-icon seerr-connection-status checking',
        pathClass: 'seerr-icon-path'
      }),
      this.el('span', { className: 'seerr-tab-text', textContent: 'Seerr' })
    ]);

    const panel = this.el('div', { className: 'seerr-panel' });
    const flyout = this.el('div', { id: flyoutId, className: 'seerr-flyout collapsed' }, [tab, panel]);

    tab.addEventListener('click', () => {
      flyout.classList.toggle('collapsed');
      flyout.classList.toggle('expanded');
    });

    this.log('Flyout created');
    return { flyout, tab, panel };
  }

  createFlyoutContent(mediaData, panel) {
    const statusIcon = this.el('div', { className: 'seerr-status-icon loading' });
    const statusText = this.el('span', { className: 'seerr-status-text', textContent: 'Connecting to Seerr...' });
    
    const statusSection = this.el('div', { className: 'seerr-status-section' }, [
      this.el('div', { className: 'seerr-media-info' }, [
        this.el('h3', { className: 'seerr-title', textContent: mediaData.title || 'Unknown Title' }),
        this.el('p', { className: 'seerr-year', textContent: `${mediaData.year || 'Unknown Year'} • ${mediaData.mediaType === 'tv' ? 'TV Series' : 'Movie'}` })
      ]),
      this.el('div', { className: 'seerr-status-indicator' }, [statusIcon, statusText])
    ]);

    const button = this.el('button', { className: 'seerr-action-button loading', disabled: 'true' }, [
      this.svg('M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z', { size: 20 }),
      this.el('span', { textContent: 'Connecting to Seerr...' })
    ]);

    panel.appendChild(statusSection);
    panel.appendChild(button);

    const watchlistButton = this.el('button', {
      className: 'seerr-watchlist-button',
      style: 'display:none'
    }, [
      this.svg('M17 12h-5v5h-2v-5H5v-2h5V5h2v5h5v2z', { size: 18 }),
      this.el('span', { textContent: 'Add to Watchlist' })
    ]);
    panel.appendChild(watchlistButton);

    return { statusSection, button, statusIcon, statusText, watchlistButton };
  }

  updateFlyoutStatus(elements, statusData) {
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

    const showWatchlist = statusData.status === 'available' || statusData.buttonClass === 'request';
    if (elements.watchlistButton) {
      elements.watchlistButton.style.display = showWatchlist ? 'flex' : 'none';
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
      .seerr-notification {
        position: fixed;
        top: 1.25rem;
        right: 1.25rem;
        background: #1f2937;
        border: 1px solid #374151;
        border-radius: 0.5rem;
        padding: 1rem;
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.25);
        z-index: 10000;
        min-width: 300px;
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

      /* Flyout Components (imported from RT styles) */
      .seerr-flyout {
        position: fixed;
        right: 0;
        top: 25%;
        transform: translateY(-50%);
        z-index: 9999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        max-width: 350px;
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

      .seerr-panel {
        width: 320px;
        background: white;
        border-radius: 8px 0 0 8px;
        box-shadow: -4px 0 20px rgba(0, 0, 0, 0.15);
        border: 1px solid #e2e8f0;
        overflow: hidden;
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

      /* Dark mode support */
      @media (prefers-color-scheme: dark) {
        .seerr-panel {
          background: #1f2937;
          border-color: #374151;
        }
        
        .seerr-title {
          color: #f9fafb;
        }
        
        .seerr-year {
          color: #9ca3af;
        }
        
        .seerr-status-text {
          color: #d1d5db;
        }
        
        .seerr-status-section {
          border-bottom-color: #374151;
        }
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
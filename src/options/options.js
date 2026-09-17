// Options page JavaScript

// Written by the Seerr overlay; see src/content/seerr-integration.js.
const RATINGS_CACHE_KEY = 'overlayRatingsV1';

class OptionsManager {
  constructor() {
    this.form = document.getElementById('settingsForm');
    this.serverUrlInput = document.getElementById('serverUrl');
    this.apiKeyInput = document.getElementById('apiKey');
    this.testButton = document.getElementById('testConnection');
    this.reloadButton = document.getElementById('reloadSettings');
    this.toggleButton = document.getElementById('toggleApiKey');
    this.skipButton = document.getElementById('skipSetup');
    this.statusDiv = document.getElementById('status');
    this.permissionWarning = document.getElementById('permissionWarning');
    this.debugLoggingInput = document.getElementById('debugLogging');
    this.clearCacheButton = document.getElementById('clearRatingsCache');
    this.cacheCount = document.getElementById('ratingsCacheCount');
    this.grantButton = document.getElementById('grantPermission');

    this.init();
  }

  async init() {
    // Load existing settings
    await this.loadSettings();
    
    // Bind event listeners
    this.form?.addEventListener('submit', (e) => this.handleSave(e));
    this.testButton?.addEventListener('click', () => this.testConnection());
    this.reloadButton?.addEventListener('click', () => this.reloadSettings());
    this.toggleButton?.addEventListener('click', () => this.toggleApiKeyVisibility());
    this.skipButton?.addEventListener('click', () => window.close());
    this.grantButton?.addEventListener('click', () => this.grantOverlayAccess());
    this.clearCacheButton?.addEventListener('click', () => this.clearRatingsCache());

    await this.refreshPermissionWarning();
    await this.refreshCacheCount();
  }

  // Cached ratings persist until cleared, so show how many are held.
  async refreshCacheCount() {
    if (!this.cacheCount) return;
    let held = 0;
    try {
      const stored = (await chrome.storage.local.get([RATINGS_CACHE_KEY]))[RATINGS_CACHE_KEY];
      held = Object.keys(stored?.entries || {}).length;
    } catch (_) {
      held = 0;
    }
    this.cacheCount.textContent = held === 0
      ? 'No ratings cached'
      : `${held} title${held === 1 ? '' : 's'} cached`;
    if (this.clearCacheButton) this.clearCacheButton.disabled = held === 0;
  }

  async clearRatingsCache() {
    try {
      // Removing the key is what open Seerr tabs watch for; a write is not a clear.
      await chrome.storage.local.remove([RATINGS_CACHE_KEY]);
      this.showStatus('success', 'Ratings cache cleared');
    } catch (error) {
      console.error('Could not clear the ratings cache:', error);
      this.showStatus('error', 'Failed to clear the ratings cache');
    }
    await this.refreshCacheCount();
  }

  // An origin match pattern for the URL in the form, or null when unusable.
  originPattern(serverUrl = this.serverUrlInput.value.trim()) {
    if (!serverUrl) return null;
    try {
      const url = new URL(serverUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      // Match patterns cannot carry a port; a bare host matches every port.
      return `${url.protocol}//${url.hostname}/*`;
    } catch (_) {
      return null;
    }
  }

  async hasOverlayPermission(pattern = this.originPattern()) {
    if (!pattern) return false;
    try {
      return await chrome.permissions.contains({ origins: [pattern] });
    } catch (_) {
      return false;
    }
  }

  // Shown whenever a server is saved but the overlay cannot run on it. Saving
  // never blocks on the grant, so this is the standing reminder to fix that.
  async refreshPermissionWarning() {
    if (!this.permissionWarning) return;
    const { seerrUrl } = await chrome.storage.sync.get(['seerrUrl']);
    const pattern = this.originPattern(seerrUrl);
    const missing = !!pattern && !(await this.hasOverlayPermission(pattern));
    this.permissionWarning.classList.toggle('hidden', !missing);
  }

  // Requests the grant and nothing else. Callers decide what follows, because
  // the ordering differs: saving must persist the new URL before the worker
  // re-registers, while the banner's button has nothing to save.
  // Chrome rejects this without an active user gesture, so callers must not
  // await anything between the click and this call.
  async requestOverlayPermission(pattern = this.originPattern()) {
    if (!pattern) return false;
    try {
      return await chrome.permissions.request({ origins: [pattern] });
    } catch (error) {
      console.error('Host permission request failed:', error);
      return false;
    }
  }

  // The banner's button: nothing to save, so nudge the worker directly.
  async grantOverlayAccess() {
    const granted = await this.requestOverlayPermission();
    if (granted) await chrome.runtime.sendMessage({ action: 'reloadSettings' }).catch(() => {});
    await this.refreshPermissionWarning();
    return granted;
  }

  async loadSettings() {
    try {
      // The URL and feature flags sync across devices; the key stays local.
      const [settings, local] = await Promise.all([
        chrome.storage.sync.get(['seerrUrl', 'overlayFeatures']),
        chrome.storage.local.get(['seerrApiKey', 'debugLogging'])
      ]);

      this.serverUrlInput.value = settings.seerrUrl || '';
      this.apiKeyInput.value = local.seerrApiKey || '';
      if (this.debugLoggingInput) this.debugLoggingInput.checked = local.debugLogging === true;
      document.querySelectorAll('[data-overlay-feature]').forEach(input => {
        input.checked = settings.overlayFeatures?.[input.dataset.overlayFeature] !== false;
      });
    } catch (error) {
      console.error('Error loading settings:', error);
      this.showStatus('error', 'Failed to load settings');
    }
  }

  async handleSave(event) {
    event.preventDefault();
    await this.saveSettings();
  }

  async saveSettings(showSuccess = true) {
    const serverUrl = this.serverUrlInput.value.trim();
    const apiKey = this.apiKeyInput.value.trim();

    // URL is required; API key is optional (ratings-only mode)
    if (!serverUrl) {
      this.showStatus('error', 'Server URL is required');
      return;
    }

    // Validate URL format
    try {
      const parsed = new URL(serverUrl);
      if (parsed.username || parsed.password || parsed.search || parsed.hash) {
        this.showStatus('error', 'Use a server URL without credentials, query parameters, or fragments');
        return;
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        this.showStatus('error', 'Server URL must use http:// or https://');
        return;
      }
    } catch (error) {
      this.showStatus('error', 'Please enter a valid server URL');
      return;
    }

    // Ask for the host permission first: everything above is synchronous, so
    // the submit that triggered this is still the active user gesture, which
    // Chrome requires. It resolves true without prompting when the origin is
    // already granted, so there is no pre-check to await the gesture away.
    const granted = await this.requestOverlayPermission(this.originPattern(serverUrl));

    try {
      // The key is a secret, so it stays on this device.
      await Promise.all([
        chrome.storage.sync.set({
          seerrUrl: serverUrl,
          overlayFeatures: Object.fromEntries(Array.from(document.querySelectorAll('[data-overlay-feature]'), input => [input.dataset.overlayFeature, input.checked]))
        }),
        chrome.storage.local.set({ seerrApiKey: apiKey, debugLogging: this.debugLoggingInput?.checked === true })
      ]);

      // The worker re-registers off this storage change, so no nudge here.
      await this.refreshPermissionWarning();

      if (showSuccess) {
        this.showStatus('success', granted
          ? 'Settings saved successfully'
          : 'Settings saved. Grant access to your Seerr server to enable the ratings overlay.');
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      this.showStatus('error', 'Failed to save settings');
    }
  }

  async reloadSettings() {
    this.reloadButton.disabled = true;
    this.reloadButton.textContent = 'Reloading...';
    this.showStatus('loading', 'Forcing background script to reload settings...');

    try {
      // Tell background script to reload settings from storage
      const response = await chrome.runtime.sendMessage({ action: 'reloadSettings' });

      if (response.success) {
        this.showStatus('success', 'Settings reloaded successfully! Try your connection now.');
      } else {
        this.showStatus('error', response.error || 'Failed to reload settings');
      }
    } catch (error) {
      console.error('Settings reload error:', error);
      this.showStatus('error', `Failed to reload settings: ${error.message}`);
    } finally {
      this.reloadButton.disabled = false;
      this.reloadButton.textContent = 'Reload Settings';
    }
  }

  async testConnection() {
    const serverUrl = this.serverUrlInput.value.trim();
    const apiKey = this.apiKeyInput.value.trim();

    if (!serverUrl) {
      this.showStatus('error', 'Please enter a server URL before testing');
      return;
    }

    if (!apiKey) {
      this.showStatus('error', 'An API key is required for this test. You can save just the server URL for ratings-only mode.');
      return;
    }

    // Validate URL format
    try {
      const parsed = new URL(serverUrl);
      if (parsed.username || parsed.password || parsed.search || parsed.hash) {
        this.showStatus('error', 'Use a server URL without credentials, query parameters, or fragments');
        return;
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        this.showStatus('error', 'Server URL must use http:// or https://');
        return;
      }
    } catch (error) {
      this.showStatus('error', 'Please enter a valid server URL');
      return;
    }

    this.testButton.disabled = true;
    this.testButton.textContent = 'Testing...';
    this.showStatus('loading', 'Testing connection to Seerr server...');

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'testConnection',
        data: { seerrUrl: serverUrl, seerrApiKey: apiKey }
      });

      if (response.success) {
        this.showStatus('success', `Connected as ${response.data.user}. Click Save Settings to apply these values.`);
      } else {
        this.showStatus('error', response.error || 'Connection test failed');
      }
    } catch (error) {
      console.error('Connection test error:', error);
      this.showStatus('error', `Connection failed: ${error.message}`);
    } finally {
      this.testButton.disabled = false;
      this.testButton.textContent = 'Test Connection';
    }
  }

  toggleApiKeyVisibility() {
    const isPassword = this.apiKeyInput.type === 'password';
    this.apiKeyInput.type = isPassword ? 'text' : 'password';
    this.toggleButton.textContent = isPassword ? 'Hide' : 'Show';
  }

  showStatus(type, message) {
    clearTimeout(this.statusTimeout);
    this.statusDiv.className = `status ${type}`;
    const statusTextEl = this.statusDiv.querySelector('.status-text');
    if (statusTextEl) statusTextEl.textContent = message;
    
    // Auto-hide status after 5 seconds (except for loading)
    if (type === 'success') {
      this.statusTimeout = setTimeout(() => {
        this.statusDiv.className = 'status hidden';
      }, 5000);
    }
  }

  hideStatus() {
    this.statusDiv.className = 'status hidden';
  }
}

// Initialize when DOM is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new OptionsManager());
} else {
  new OptionsManager();
}
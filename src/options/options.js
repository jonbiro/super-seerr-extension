// Options page JavaScript

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
    
    // Auto-save on input change (with debounce)
    let saveTimeout;
    [this.serverUrlInput, this.apiKeyInput].forEach(input => {
      input?.addEventListener('input', () => {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => this.autoSave(), 1000);
      });
    });
  }

  async loadSettings() {
    try {
      const settings = await chrome.storage.sync.get(['seerrUrl', 'seerrApiKey']);
      
      if (settings.seerrUrl) {
        this.serverUrlInput.value = settings.seerrUrl;
      }
      
      if (settings.seerrApiKey) {
        this.apiKeyInput.value = settings.seerrApiKey;
      }
    } catch (error) {
      console.error('Error loading settings:', error);
      this.showStatus('error', 'Failed to load settings');
    }
  }

  async handleSave(event) {
    event.preventDefault();
    await this.saveSettings();
  }

  async autoSave() {
    // Only auto-save if URL has a value
    if (this.serverUrlInput.value.trim()) {
      await this.saveSettings(false); // Don't show success message for auto-save
    }
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
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        this.showStatus('error', 'Server URL must use http:// or https://');
        return;
      }
    } catch (error) {
      this.showStatus('error', 'Please enter a valid server URL');
      return;
    }

    try {
      // Save to storage
      await chrome.storage.sync.set({
        seerrUrl: serverUrl,
        seerrApiKey: apiKey
      });

      if (showSuccess) {
        this.showStatus('success', 'Settings saved successfully');
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
      this.showStatus('error', 'An API key is required to test the connection. Enter your key or skip setup.');
      return;
    }

    // Validate URL format
    try {
      const parsed = new URL(serverUrl);
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
      // Save settings first (so background script can use them)
      await chrome.storage.sync.set({
        seerrUrl: serverUrl,
        seerrApiKey: apiKey
      });

      // Brief delay to let storage sync propagate to the background worker
      await new Promise(resolve => setTimeout(resolve, 100));

      // Test the connection via background script
      const response = await chrome.runtime.sendMessage({ action: 'testConnection' });

      if (response.success) {
        this.showStatus('success', `Connected successfully! Welcome, ${response.data.user}`);
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
    this.statusDiv.className = `status ${type}`;
    const statusTextEl = this.statusDiv.querySelector('.status-text');
    if (statusTextEl) statusTextEl.textContent = message;
    
    // Auto-hide status after 5 seconds (except for loading)
    if (type !== 'loading') {
      setTimeout(() => {
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
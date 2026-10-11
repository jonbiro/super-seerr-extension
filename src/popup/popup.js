// Popup JavaScript

class PopupManager {
  constructor() {
    this.statusIndicator = document.getElementById('statusIndicator');
    this.configuredState = document.getElementById('configuredState');
    this.notConfiguredState = document.getElementById('notConfiguredState');
    this.errorState = document.getElementById('errorState');
    this.errorMessage = document.getElementById('errorMessage');
    this.serverUrlSpan = document.getElementById('serverUrl');
    this.configuredHeading = document.getElementById('configuredHeading');
    this.configuredDetail = document.getElementById('configuredDetail');
    this.openOptionsButton = document.getElementById('openOptions');
    this.testConnectionButton = document.getElementById('testConnection');
    
    this.checkGeneration = 0;
    this.init();
  }

  async init() {
    // Bind event listeners
    this.openOptionsButton?.addEventListener('click', () => this.openOptions());
    this.testConnectionButton?.addEventListener('click', () => this.testConnection());
    
    chrome.runtime.onMessage?.addListener(message => {
      if (message?.action === 'seerrConfigChanged') void this.checkStatus();
    });

    // Check status on load
    await this.checkStatus();
  }

  async checkStatus() {
    const generation = ++this.checkGeneration;
    this.setStatus('loading', 'Checking connections…');
    const diagnostics = document.getElementById('diagnosticChecks');
    const repairFocused = diagnostics.contains(document.activeElement);
    this.testConnectionButton.disabled = true;
    this.testConnectionButton.querySelector('span').textContent = 'Checking…';
    this.configuredState.classList.add('hidden');
    this.notConfiguredState.classList.add('hidden');
    this.errorState.classList.add('hidden');
    diagnostics.replaceChildren();
    diagnostics.setAttribute('aria-busy', 'true');
    if (repairFocused) this.openOptionsButton.focus();
    try {
      const response = await this.sendMessage({ action: 'getPopupDiagnostics' });
      if (generation !== this.checkGeneration) return;
      if (!response?.success || !response.data?.checks) throw new Error('Unable to load diagnostics. Reopen the popup to retry.');
      const { serverUrl, checks } = response.data;
      this.renderDiagnostics(checks);
      if (!serverUrl) this.showNotConfiguredState();
      else {
        this.serverUrlSpan.textContent = this.formatServerUrl(serverUrl);
        this.serverUrlSpan.title = serverUrl;
        const unverifiedKey = response.data.apiKeyConfigured === true && checks.apiKey.state !== 'ok';
        this.describeConfigured(checks.apiKey.state === 'ok', unverifiedKey);
        this.showConfiguredState();
        const issues = unverifiedKey || checks.seerr.state !== 'ok' || checks.permission.state !== 'ok' || Object.values(checks).some(check => check.state === 'error');
        if (checks.seerr.state !== 'ok' || checks.permission.state !== 'ok') {
          this.configuredHeading.textContent = 'Check your connection';
          this.configuredDetail.textContent = 'Use the checks below to restore ratings and request access.';
        }
        this.setStatus(issues ? 'warning' : 'connected', issues ? 'Connection needs attention' : checks.apiKey.state === 'ok' ? 'Ready to request' : 'Ratings-only mode');
      }
      this.testConnectionButton.classList.remove('hidden');
    } catch (error) {
      if (generation !== this.checkGeneration) return;
      document.getElementById('diagnosticChecks').replaceChildren();
      this.showErrorState(error.message);
      this.setStatus('error', 'Could not check connections');
    } finally {
      if (generation === this.checkGeneration) {
        diagnostics.removeAttribute('aria-busy');
        this.testConnectionButton.disabled = false;
        this.testConnectionButton.querySelector('span').textContent = 'Check connections';
      }
    }
  }

  renderDiagnostics(checks) {
    const container = document.getElementById('diagnosticChecks');
    container.replaceChildren();
    const labels = { seerr: 'Seerr connection', permission: 'Host permission', apiKey: 'API key', plex: 'Plex' };
    for (const [key, label] of Object.entries(labels)) {
      const check = checks[key];
      const row = document.createElement('div'); row.className = 'diagnostic-row';
      const heading = document.createElement('strong'); heading.textContent = `${label}: ${check.state === 'ok' ? 'OK' : check.state === 'error' ? 'Needs fixing' : 'Needs attention'}`;
      const detail = document.createElement('p'); detail.textContent = check.message;
      row.append(heading, detail);
      if (check.fix) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'button secondary';
        button.textContent = `Fix ${label.toLowerCase()}`;
        button.addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL(`src/options/options.html#${check.fix}`) }));
        row.appendChild(button);
      }
      container.appendChild(row);
    }
  }

  // Missing, unverified and accepted keys need different next steps. A saved
  // key that could not be checked must not be described as absent.
  describeConfigured(canRequest, unverifiedKey = false) {
    if (!this.configuredHeading || !this.configuredDetail) return;
    this.configuredHeading.textContent = canRequest ? 'Ready to request' : unverifiedKey ? 'Check your API key' : 'Ratings are on';
    this.configuredDetail.textContent = canRequest
      ? 'Ratings show on your Seerr pages, and you can request titles from IMDb, Rotten Tomatoes and five more sites.'
      : unverifiedKey ? 'Ratings show on your Seerr pages. Your saved API key is not verified. Review the API key check below before requesting titles.'
      : 'Ratings show on your Seerr pages. Add an API key in Settings to request titles from IMDb, Rotten Tomatoes and five more sites.';
  }

  showConfiguredState() {
    this.hideAllStates();
    this.configuredState.classList.remove('hidden');
    this.testConnectionButton.classList.remove('hidden');
  }

  showNotConfiguredState() {
    this.hideAllStates();
    this.notConfiguredState.classList.remove('hidden');
    this.setStatus('warning', 'Set your Seerr server URL');
  }

  showErrorState(message) {
    this.hideAllStates();
    this.errorState.classList.remove('hidden');
    this.errorMessage.textContent = message;
    this.testConnectionButton.classList.remove('hidden');
  }

  hideAllStates() {
    this.configuredState.classList.add('hidden');
    this.notConfiguredState.classList.add('hidden');
    this.errorState.classList.add('hidden');
    this.testConnectionButton.classList.add('hidden');
  }

  setStatus(type, text) {
    // Remove all status classes
    this.statusIndicator.classList.remove('connected', 'error', 'warning', 'loading');
    
    // Add new status class
    this.statusIndicator.classList.add(type);
    
    // Update status text
    this.statusIndicator.querySelector('.status-text').textContent = text;
  }

  formatServerUrl(url) {
    try {
      const urlObj = new URL(url);
      // Preserve the port and installation path: saved sites can share a host.
      return urlObj.host + urlObj.pathname.replace(/\/+$/, '');
    } catch (error) {
      return url;
    }
  }

  async openOptions() {
    try {
      await chrome.runtime.openOptionsPage();
      window.close();
    } catch (error) {
      console.error('Error opening options page:', error);
    }
  }

  async testConnection() {
    if (this.testConnectionButton.disabled) return;
    await this.checkStatus();
  }

  async sendMessage(message) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (err) {
      throw new Error(err.message);
    }
  }
}

// Initialize when DOM is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new PopupManager());
} else {
  new PopupManager();
}

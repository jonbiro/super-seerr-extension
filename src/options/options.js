// Options page JavaScript

// Written by the Seerr overlay; see src/content/seerr-integration.js.
const RATINGS_CACHE_KEY = 'overlayRatingsV1';
const SITE_RATINGS_CACHE_KEY = 'overlayRatingsByServerV1';
// The overlay's record of which ratings endpoints this server does not serve.
// Clearing the cache means "ask again", so this goes with it.
const RATINGS_UNAVAILABLE_KEY = 'seerrRatingsUnavailableV1';
const RT_CACHE_KEY = 'rtCacheV1';

class OptionsManager {
  constructor() {
    this.form = document.getElementById('settingsForm');
    this.serverUrlInput = document.getElementById('serverUrl');
    this.apiKeyInput = document.getElementById('apiKey');
    this.plexTokenInput = document.getElementById('plexToken');
    this.testButton = document.getElementById('testConnection');
    this.testPlexButton = document.getElementById('testPlexConnection');
    this.reloadButton = document.getElementById('reloadSettings');
    this.toggleButton = document.getElementById('toggleApiKey');
    this.togglePlexButton = document.getElementById('togglePlexToken');
    this.statusDiv = document.getElementById('status');
    this.permissionWarning = document.getElementById('permissionWarning');
    this.debugLoggingInput = document.getElementById('debugLogging');
    this.clearCacheButton = document.getElementById('clearRatingsCache');
    this.cacheCount = document.getElementById('ratingsCacheCount');
    this.grantButton = document.getElementById('grantPermission');

    this.init();
  }

  async init() {
    chrome.storage.onChanged?.addListener((changes, area) => {
      if (area === 'local' && [RATINGS_CACHE_KEY, SITE_RATINGS_CACHE_KEY, RT_CACHE_KEY,
        'publicRatingsV1', RATINGS_UNAVAILABLE_KEY, 'ratingsCacheEpoch'].some(key => key in changes)) {
        void this.refreshCacheCount();
      }
      if ((area === 'local' && changes.seerrConnectionsV1) || (area === 'sync' && changes.seerrUrl)) {
        // Refresh the active label and available actions without discarding
        // the site (or unsaved credentials) this window is editing.
        this.loadConnectionChoices();
        this.refreshPermissionWarning().catch(() => {});
      }
    });
    // Bind before reading storage so even an early submit is intercepted.
    document.getElementById('retrySeerrSites')?.addEventListener('click', () => this.loadConnectionChoices());
    document.getElementById('addSeerrSite')?.addEventListener('click', () => this.newConnection());
    document.getElementById('savedSeerrSites')?.addEventListener('change', () => this.editConnection());
    document.getElementById('useSeerrSite')?.addEventListener('click', () => this.useConnection());
    document.getElementById('removeSeerrSite')?.addEventListener('click', () => this.removeConnection());
    this.form?.addEventListener('submit', (e) => this.handleSave(e));
    this.testButton?.addEventListener('click', () => this.testConnection());
    this.testPlexButton?.addEventListener('click', () => this.testPlexConnection());
    this.reloadButton?.addEventListener('click', () => this.reloadSettings());
    this.toggleButton?.addEventListener('click', () => this.toggleApiKeyVisibility());
    this.togglePlexButton?.addEventListener('click', () => this.togglePlexTokenVisibility());
    this.grantButton?.addEventListener('click', () => this.grantOverlayAccess());
    this.clearCacheButton?.addEventListener('click', () => this.clearRatingsCache());

    // Initial reads replace the form just like selecting a saved site.
    this._connectionBusy = true;
    this.updateConnectionControls();
    try {
      await this.loadSettings();
      await this.loadConnectionChoices();
    } finally {
      this._connectionBusy = false;
      this.updateConnectionControls();
    }

    // A permission-state read failure must not prevent the remaining setup.
    await this.refreshPermissionWarning().catch(() => {});
    await this.refreshCacheCount();
    this.focusDiagnosticSetting();
    window.addEventListener('hashchange', () => this.focusDiagnosticSetting());
  }

  // Popup repair links focus controls after asynchronous settings have loaded.
  focusDiagnosticSetting() {
    const id = location.hash.slice(1);
    if (!['serverUrl', 'apiKey', 'plexToken', 'permissionWarning'].includes(id)) return;
    const target = document.getElementById(id === 'permissionWarning' ? 'grantPermission' : id);
    target?.scrollIntoView?.({ block: 'center' });
    target?.focus();
  }

  // Cached ratings persist until cleared, so show how many are held.
  async refreshCacheCount() {
    if (!this.cacheCount) return;
    const generation = this.cacheCountGeneration = (this.cacheCountGeneration || 0) + 1;
    let held = 0;
    try {
      const stored = await chrome.storage.local.get([RATINGS_CACHE_KEY, SITE_RATINGS_CACHE_KEY, RT_CACHE_KEY, 'publicRatingsV1', RATINGS_UNAVAILABLE_KEY]);
      if (generation !== this.cacheCountGeneration) return;
      held = Object.keys(stored[RATINGS_CACHE_KEY]?.entries || {}).length +
        Object.values(stored[SITE_RATINGS_CACHE_KEY] || {}).reduce((count, cache) => count + Object.keys(cache?.entries || {}).length, 0) +
        Object.keys(stored[RT_CACHE_KEY]?.entries || {}).length + Object.keys(stored.publicRatingsV1?.entries || {}).length;
      this.hasRatingsAvailability = !!stored[RATINGS_UNAVAILABLE_KEY];
    } catch (_) {
      if (generation !== this.cacheCountGeneration) return;
      this.cacheCount.textContent = 'Could not read the ratings cache';
      if (this.clearCacheButton) this.clearCacheButton.disabled = !!this.clearingCache;
      return;
    }
    this.cacheCount.textContent = held === 0
      ? 'No ratings cached'
      : `${held} cache entr${held === 1 ? 'y' : 'ies'}`;
    if (this.clearCacheButton) this.clearCacheButton.disabled = !!this.clearingCache || (held === 0 && !this.hasRatingsAvailability);
  }

  async clearRatingsCache() {
    if (this.clearingCache) return;
    this.clearingCache = true;
    const label = this.clearCacheButton?.textContent;
    if (this.clearCacheButton) { this.clearCacheButton.disabled = true; this.clearCacheButton.textContent = 'Clearing…'; }
    try {
      const response = await chrome.runtime.sendMessage({ action: 'clearRatingsCache' });
      if (!response?.success) throw new Error(response?.error || 'Cache clear failed');
      this.showStatus('success', 'Ratings cache cleared');
    } catch (error) {
      console.error('Could not clear the ratings cache:', error);
      this.showStatus('error', 'Failed to clear the ratings cache');
    }
    this.clearingCache = false;
    if (this.clearCacheButton) this.clearCacheButton.textContent = label;
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
    const generation = this.permissionGeneration = (this.permissionGeneration || 0) + 1;
    const [{ seerrUrl }, local] = await Promise.all([chrome.storage.sync.get(['seerrUrl']), chrome.storage.local.get('seerrConnectionsV1')]);
    const connections = local.seerrConnectionsV1;
    const activeUrl = connections ? connections.sites.find(site => site.id === connections.activeId)?.url : seerrUrl;
    const pattern = this.originPattern(activeUrl || '');
    const missing = !!pattern && !(await this.hasOverlayPermission(pattern));
    if (generation !== this.permissionGeneration) return;
    this.savedPermissionPattern = pattern;
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
    const granted = await this.requestOverlayPermission(this.savedPermissionPattern || null);
    if (granted) await chrome.runtime.sendMessage({ action: 'reloadSettings' }).catch(() => {});
    await this.refreshPermissionWarning();
    return granted;
  }

  async loadSettings() {
    try {
      // The URL and feature flags sync across devices; the keys stay local.
      const [settings, local] = await Promise.all([
        chrome.storage.sync.get(['seerrUrl', 'overlayFeatures']),
        chrome.storage.local.get(['seerrApiKey', 'plexToken', 'debugLogging', 'seerrConnectionsV1'])
      ]);

      const connections = local.seerrConnectionsV1;
      const active = connections?.sites.find(site => site.id === connections.activeId);
      const serverUrl = active?.url || settings.seerrUrl || '';
      const connectionId = active?.id ?? (!connections && settings.seerrUrl
        ? new URL(settings.seerrUrl).href.replace(/\/+$/, '') : undefined);
      const apiKey = active ? active.apiKey : local.seerrApiKey || '';
      // Revealing one credential does not authorize revealing its replacement
      // after a site removal, activation, or settings reload.
      if (this.apiKeyInput.type !== 'password' && (this.connectionId !== connectionId ||
          this.serverUrlInput.value !== serverUrl || this.apiKeyInput.value !== apiKey)) this.toggleApiKeyVisibility();
      this.connectionMode = !!connections;
      this.connectionId = connectionId;
      this.serverUrlInput.value = serverUrl;
      this.apiKeyInput.value = apiKey;
      if (document.getElementById('seerrSiteName')) document.getElementById('seerrSiteName').value = active?.name || '';
      if (this.plexTokenInput) {
        const token = local.plexToken || '';
        if (this.plexTokenInput.type !== 'password' && this.plexTokenInput.value !== token) this.togglePlexTokenVisibility();
        this.plexTokenInput.value = token;
      }
      if (this.debugLoggingInput) this.debugLoggingInput.checked = local.debugLogging === true;
      document.querySelectorAll('[data-overlay-feature]').forEach(input => {
        input.checked = settings.overlayFeatures?.[input.dataset.overlayFeature] !== false;
      });
      return true;
    } catch (error) {
      console.error('Error loading settings:', error);
      this.showStatus('error', 'Failed to load settings');
      return false;
    }
  }

  async handleSave(event) {
    event.preventDefault();
    await this.saveSettings();
  }

  async saveSettings(showSuccess = true) {
    // Double submissions would prompt for host permissions twice, and the
    // second prompt arrives with no user gesture left to grant it on.
    if (this._saving || this._connectionBusy) return;
    this._saving = true;
    this.updateConnectionControls();
    try {
      await this.saveSettingsInner(showSuccess);
    } finally {
      this._saving = false;
      this.updateConnectionControls();
    }
  }

  settingsDraft() {
    return {
      serverUrl: this.serverUrlInput.value.trim(),
      apiKey: this.apiKeyInput.value.trim(),
      plexToken: this.plexTokenInput ? this.plexTokenInput.value.trim() : '',
      connectionName: document.getElementById('seerrSiteName')?.value.trim(),
      overlayFeatures: Object.fromEntries(Array.from(document.querySelectorAll('[data-overlay-feature]'), input => [input.dataset.overlayFeature, input.checked])),
      debugLogging: this.debugLoggingInput?.checked === true
    };
  }

  async saveSettingsInner(showSuccess = true) {
    const draft = this.settingsDraft();
    const { serverUrl, apiKey, plexToken, connectionName, overlayFeatures, debugLogging } = draft;
    const connectionId = this.connectionId;

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

    // One request keeps every new origin under the submit's user gesture.
    // Awaiting the Seerr prompt before asking for Plex can lose that gesture.
    const pattern = this.originPattern(serverUrl);
    const origins = [...new Set([pattern, ...(plexToken ? this.plexPermissionOrigins() : [])])];
    let allGranted = false;
    try {
      allGranted = await chrome.permissions.request({ origins });
    } catch (error) {
      console.error('Host permission request failed:', error);
    }
    // A declined combined request does not revoke origins already granted.
    const granted = allGranted || await this.hasOverlayPermission(pattern);
    const plexGranted = !plexToken || allGranted || await chrome.permissions.contains({
      origins: this.plexPermissionOrigins()
    }).catch(() => false);

    try {
      // Saved profiles commit the URL and key together in the worker.
      if (this.connectionMode || connectionName) {
        const response = await chrome.runtime.sendMessage({ action: 'saveSeerrConnection', data: { id: connectionId, name: connectionName, url: serverUrl, apiKey } });
        if (!response?.success) throw new Error(response?.error || 'Could not save this site');
        this.connectionMode = true;
        // Keep the identity confirmed by this save even if another window
        // activates a different site before the following metadata refresh.
        this.connectionId = response.data.activeId;
        await chrome.storage.sync.set({ overlayFeatures });
        await chrome.storage.local.set({ plexToken, debugLogging });
      } else await Promise.all([
        chrome.storage.sync.set({
          seerrUrl: serverUrl,
          overlayFeatures
        }),
        chrome.storage.local.set({ seerrApiKey: apiKey, plexToken, debugLogging })
      ]);

      if (!this.connectionMode) this.connectionId = new URL(serverUrl).href.replace(/\/+$/, '');

      await this.loadConnectionChoices();
      // The worker re-registers off this storage change, so no nudge here.
      await this.refreshPermissionWarning();

      if (showSuccess && JSON.stringify(this.settingsDraft()) !== JSON.stringify(draft)) {
        this.showStatus('info', 'Earlier settings saved. Your newer edits are not saved yet. Click Save Settings to apply them.');
      } else if (showSuccess) {
        this.showStatus('success', !granted
          ? 'Settings saved. Grant access to your Seerr server to enable the ratings overlay.'
          : plexToken && !plexGranted
            ? 'Settings saved. The Plex host permission was declined, so Plex Watchlist actions will fail until it is granted.'
            : 'Settings saved successfully');
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      this.showStatus('error', error.message || 'Failed to save settings');
    }
  }

  async loadConnectionChoices() {
    const generation = this.connectionChoicesGeneration = (this.connectionChoicesGeneration || 0) + 1;
    const retry = document.getElementById('retrySeerrSites');
    const restoreRetryFocus = document.activeElement === retry;
    this.connectionChoicesLoading = true;
    this.updateConnectionControls();
    if (retry) retry.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getSeerrConnections' });
      if (generation !== this.connectionChoicesGeneration) return;
      if (!response?.success || !Array.isArray(response.data?.sites)) throw new Error('Saved sites unavailable');
      this.connectionChoicesUnavailable = false;
      document.getElementById('seerrSitesError')?.classList.add('hidden');
      this.connectionChoices = response.data;
      // Another window may have migrated the legacy URL/key into profiles.
      // Future saves must update that authoritative record, preserving this draft.
      if (response.data.revision > 0) this.connectionMode = true;
      const select = document.getElementById('savedSeerrSites');
      if (!select) return;
      select.replaceChildren();
      for (const site of response.data.sites) {
        const option = document.createElement('option');
        option.value = site.id; option.textContent = `${site.name} — ${site.url}`;
        select.append(option);
      }
      const selectedId = this.editingConnectionId ?? this.connectionId;
      this.selectConnectionChoice(selectedId);
      const active = response.data.sites.find(site => site.id === response.data.activeId);
      document.getElementById('activeSeerrSite').textContent = active ? `Active site: ${active.name} (${active.url})` : 'No site saved yet.';
      this.updateConnectionControls();
    } catch (_) {
      if (generation !== this.connectionChoicesGeneration) return;
      this.connectionChoicesUnavailable = true;
      document.getElementById('seerrSitesError')?.classList.remove('hidden');
      this.updateConnectionControls();
    } finally {
      if (generation === this.connectionChoicesGeneration) {
        this.connectionChoicesLoading = false;
        if (retry) retry.disabled = false;
        this.updateConnectionControls();
        if (restoreRetryFocus && (document.activeElement === retry || document.activeElement === document.body)) {
          const target = this.connectionChoicesUnavailable ? retry : document.getElementById('savedSeerrSites');
          target?.focus();
        }
      }
    }
  }

  selectConnectionChoice(id) {
    const select = document.getElementById('savedSeerrSites');
    if (!Array.from(select.options).some(option => option.value === (id || ''))) {
      const draft = document.createElement('option');
      draft.value = id || '';
      draft.textContent = id ? 'Removed site (unsaved edits)' : 'New site (not saved)';
      draft.disabled = true;
      select.append(draft);
    }
    select.value = id || '';
  }

  updateConnectionControls() {
    const busy = !!(this._saving || this._connectionBusy);
    // Site reads replace form values. Prevent typing into the old site's
    // fields while they are pending, and restore any prior disabled states.
    // Saves retain the editable draft because they never replace its values.
    if (this._connectionBusy && !this.lockedSettingsInputs) {
      this.lockedSettingsInputs = new Map(Array.from(this.form.querySelectorAll('input'), input => [input, input.disabled]));
      for (const input of this.lockedSettingsInputs.keys()) input.disabled = true;
    } else if (!this._connectionBusy && this.lockedSettingsInputs) {
      for (const [input, disabled] of this.lockedSettingsInputs) input.disabled = disabled;
      this.lockedSettingsInputs = null;
    }
    this.form.setAttribute('aria-busy', String(busy));
    const submit = this.form.querySelector('button[type=submit]');
    if (submit) submit.disabled = busy;
    if (this.testButton) this.testButton.disabled = !!(this._connectionBusy || this._testingSeerr);
    if (this.testPlexButton) this.testPlexButton.disabled = !!(this._connectionBusy || this._testingPlex);
    const selected = this.connectionChoices?.sites.find(site => site.id === this.connectionId);
    for (const id of ['addSeerrSite', 'savedSeerrSites']) {
      const control = document.getElementById(id); if (control) control.disabled = busy;
    }
    for (const id of ['useSeerrSite', 'removeSeerrSite']) {
      const control = document.getElementById(id);
      if (control) control.disabled = busy || this.connectionChoicesLoading === true || this.connectionChoicesUnavailable === true || !selected || selected.id === this.connectionChoices.activeId;
    }
  }

  newConnection() {
    this.connectionMode = true; this.connectionId = null;
    const select = document.getElementById('savedSeerrSites');
    if (!Array.from(select.options).some(option => option.value === '')) {
      const draft = document.createElement('option');
      draft.value = ''; draft.textContent = 'New site (not saved)'; draft.disabled = true;
      select.append(draft);
    }
    select.value = '';
    document.getElementById('seerrSiteName').value = '';
    this.serverUrlInput.value = ''; this.apiKeyInput.value = '';
    this.apiKeyInput.type = 'password'; this.toggleButton.textContent = 'Show';
    this.toggleButton.setAttribute('aria-label', 'Show Seerr API key');
    this.updateConnectionControls(); this.serverUrlInput.focus();
    this.showStatus('info', 'Enter the new site URL and its own API key, then Save Settings to activate it.');
  }

  async editConnection() {
    this.editingConnectionId = document.getElementById('savedSeerrSites').value;
    this.showStatus('loading', 'Loading saved site…');
    this._connectionBusy = true; this.updateConnectionControls();
    try {
      const id = this.editingConnectionId;
      const local = await chrome.storage.local.get('seerrConnectionsV1');
      const site = local.seerrConnectionsV1?.sites.find(item => item.id === id);
      if (local.seerrConnectionsV1 && !site) throw new Error('Site removed');
      if (site) {
        this.connectionMode = true; this.connectionId = site.id;
        this.serverUrlInput.value = site.url; this.apiKeyInput.value = site.apiKey;
        document.getElementById('seerrSiteName').value = site.name;
      } else {
        if (!await this.loadSettings()) throw new Error('Settings unavailable');
        this.connectionId = id;
      }
      this.apiKeyInput.type = 'password'; this.toggleButton.textContent = 'Show';
      this.toggleButton.setAttribute('aria-label', 'Show Seerr API key');
      this.showStatus('info', 'Saved site loaded. Test its connection or edit and save its settings.');
    } catch (_) {
      // The fields still belong to the last successfully loaded site.
      this.selectConnectionChoice(this.connectionId);
      this.showStatus('error', 'Could not load this site. Reload Settings.');
    }
    finally {
      this.editingConnectionId = null;
      this._connectionBusy = false;
      this.updateConnectionControls();
    }
  }

  async useConnection() {
    const selected = this.connectionChoices?.sites.find(site => site.id === this.connectionId);
    if (!selected || this._connectionBusy || this.connectionChoicesLoading || this.connectionChoicesUnavailable) return;
    // Request access from this click, before any storage or messaging await.
    const permission = this.requestOverlayPermission(this.originPattern(selected.url));
    this._connectionBusy = true; this.updateConnectionControls();
    try {
      if (!await permission) throw new Error('Site access was declined. The active site has not changed.');
      const response = await chrome.runtime.sendMessage({ action: 'activateSeerrConnection', data: { id: selected.id } });
      if (!response?.success) throw new Error(response?.error || 'Could not switch sites');
      const loaded = await this.loadSettings();
      await this.loadConnectionChoices();
      if (loaded) await this.refreshPermissionWarning();
      this.showStatus(loaded ? 'success' : 'error', loaded
        ? `Now using ${selected.name}. Reload its Seerr tab if ratings are not visible yet.`
        : 'Site switched, but the saved settings could not be loaded. Reload this Settings page before saving changes.');
    } catch (error) { this.showStatus('error', error.message); }
    finally { this._connectionBusy = false; this.updateConnectionControls(); }
  }

  async removeConnection() {
    if (this._connectionBusy || this.connectionChoicesLoading || this.connectionChoicesUnavailable) return;
    this._connectionBusy = true; this.updateConnectionControls();
    try {
      const response = await chrome.runtime.sendMessage({ action: 'removeSeerrConnection', data: { id: this.connectionId } });
      if (!response?.success) throw new Error(response?.error || 'Could not remove this site');
      const loaded = await this.loadSettings();
      await this.loadConnectionChoices();
      this.showStatus(loaded ? 'success' : 'error', loaded
        ? 'Saved site removed. Its server and historical actions were not changed.'
        : 'Saved site removed, but the saved settings could not be loaded. Reload this Settings page before saving changes.');
    } catch (error) { this.showStatus('error', error.message); }
    finally { this._connectionBusy = false; this.updateConnectionControls(); }
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
    if (this.testButton.disabled || this._connectionBusy) return;
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

    this._testingSeerr = true;
    this.updateConnectionControls();
    this.testButton.textContent = 'Testing...';
    this.showStatus('loading', 'Testing connection to Seerr server...');
    const current = this.connectionTestGuard(() => this.serverUrlInput.value.trim() === serverUrl && this.apiKeyInput.value.trim() === apiKey);

    try {
      // Testing unsaved settings needs the same user-gesture host grant as
      // saving, while leaving the saved server and credentials unchanged.
      const granted = await this.requestOverlayPermission(this.originPattern(serverUrl));
      if (!current()) return;
      if (!granted) {
        this.showStatus('error', 'Seerr host permission is required to test the connection. Click Test Connection to grant access.');
        return;
      }
      await this.refreshPermissionWarning().catch(() => {});
      if (!current()) return;
      const response = await chrome.runtime.sendMessage({
        action: 'testConnection',
        data: { seerrUrl: serverUrl, seerrApiKey: apiKey }
      });

      if (!current()) return;
      if (response?.success) {
        this.showStatus('success', `Connected as ${response.data.user}. Click Save Settings to apply these values.`);
      } else {
        this.showStatus('error', response?.error || 'Connection test failed');
      }
    } catch (error) {
      if (!current()) return;
      console.error('Connection test error:', error);
      this.showStatus('error', `Connection failed: ${error.message}`);
    } finally {
      this._testingSeerr = false;
      this.updateConnectionControls();
      this.testButton.textContent = 'Test Connection';
    }
  }

  toggleApiKeyVisibility() {
    const isPassword = this.apiKeyInput.type === 'password';
    this.apiKeyInput.type = isPassword ? 'text' : 'password';
    this.toggleButton.textContent = isPassword ? 'Hide' : 'Show';
    this.toggleButton.setAttribute('aria-label', `${isPassword ? 'Hide' : 'Show'} Seerr API key`);
  }

  togglePlexTokenVisibility() {
    if (!this.plexTokenInput) return;
    const isPassword = this.plexTokenInput.type === 'password';
    this.plexTokenInput.type = isPassword ? 'text' : 'password';
    if (this.togglePlexButton) {
      this.togglePlexButton.textContent = isPassword ? 'Hide' : 'Show';
      this.togglePlexButton.setAttribute('aria-label', `${isPassword ? 'Hide' : 'Show'} Plex token`);
    }
  }

  plexPermissionOrigins() {
    return ['https://plex.tv/*', 'https://*.plex.tv/*'];
  }

  async requestPlexPermission() {
    try {
      return await chrome.permissions.request({ origins: this.plexPermissionOrigins() });
    } catch (error) {
      console.error('Plex permission request failed:', error);
      return false;
    }
  }

  async testPlexConnection() {
    if (this.testPlexButton?.disabled || this._connectionBusy) return;
    const plexToken = this.plexTokenInput ? this.plexTokenInput.value.trim() : '';
    if (!plexToken) {
      this.showStatus('error', 'Enter a Plex token before testing');
      return;
    }
    if (!this.testPlexButton) return;
    this._testingPlex = true;
    this.updateConnectionControls();
    this.testPlexButton.textContent = 'Testing...';
    this.showStatus('loading', 'Testing Plex connection...');
    const current = this.connectionTestGuard(() => this.plexTokenInput.value.trim() === plexToken);
    try {
      // This button is also used before the first save, when Plex has no grant.
      const granted = await this.requestPlexPermission();
      if (!current()) return;
      if (!granted) {
        this.showStatus('error', 'Plex host permission is required to test the connection. Click Test Plex to grant access.');
        return;
      }
      const response = await chrome.runtime.sendMessage({
        action: 'plexTestConnection',
        data: { plexToken }
      });
      if (!current()) return;
      if (response && response.success) {
        this.showStatus('success', `Plex connected as ${response.data.user}. Click Save Settings to apply.`);
      } else {
        this.showStatus('error', (response && response.error) || 'Plex connection test failed');
      }
    } catch (error) {
      if (!current()) return;
      console.error('Plex connection test error:', error);
      this.showStatus('error', `Plex connection failed: ${error.message}`);
    } finally {
      this._testingPlex = false;
      this.updateConnectionControls();
      this.testPlexButton.textContent = 'Test Plex';
    }
  }

  connectionTestGuard(valuesMatch) {
    const revision = this.statusRevision;
    return () => {
      if (revision !== this.statusRevision) return false;
      if (valuesMatch()) return true;
      this.showStatus('error', 'Settings changed during the test. Test again to check the current values.');
      return false;
    };
  }

  showStatus(type, message) {
    this.statusRevision = (this.statusRevision || 0) + 1;
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

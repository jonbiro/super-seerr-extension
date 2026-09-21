// Only extension pages receive diagnostics; credentials and remote error bodies stay here.
(function (root) {
  const row = (state, message, fix = null) => ({ state, message, fix });
  root.PopupDiagnostics = {
    async exportDiagnostics() {
      const report = await this.getPopupDiagnostics();
      const checks = {};
      for (const name of ['permission', 'apiKey', 'seerr', 'plex']) {
        const state = report.checks[name]?.state;
        checks[name] = ['ok', 'warning', 'error'].includes(state) ? state : 'unknown';
      }
      return { schema: 1, version: chrome.runtime.getManifest().version, checkedAt: new Date().toISOString(),
        localStorageIsolationSupported: typeof chrome.storage.local.setAccessLevel === 'function', checks };
    },
    async getPopupDiagnostics() {
      const result = { serverUrl: null, checks: {} };
      const checks = result.checks;
      let url;
      try {
        url = new URL(this.baseUrl);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) url = null;
      } catch (_) { url = null; }
      result.serverUrl = url?.href || null;
      const permission = url && await chrome.permissions.contains({ origins: [`${url.protocol}//${url.hostname}/*`] });
      checks.permission = !url ? row('warning', 'Set a valid Seerr URL first.', 'serverUrl')
        : permission ? row('ok', 'Seerr host access granted.') : row('error', 'Seerr host access is missing.', 'permissionWarning');
      checks.apiKey = this.apiKey ? row('warning', 'Saved; not verified yet.', 'apiKey') : row('warning', 'No API key. Requests are disabled; ratings can still work.', 'apiKey');
      checks.seerr = !url ? row('warning', 'Seerr URL is not configured.', 'serverUrl')
        : !permission ? row('warning', 'Grant host access before testing connectivity.', 'permissionWarning') : row('warning', 'Not checked.');
      await Promise.all([
        (async () => {
          if (!permission) return;
          try {
            const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/v1/settings/public`, {
              redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(root.RatingsConfig.requestTimeoutMs)
            });
            checks.seerr = response.ok ? row('ok', 'Seerr is reachable.') : row('error', `Seerr returned HTTP ${response.status}. Check the server URL and proxy.`, 'serverUrl');
          } catch (_) { checks.seerr = row('error', 'Cannot reach Seerr. Check the URL, network, and server.', 'serverUrl'); }
          if (!this.apiKey) return;
          try {
            await this.makeAPIRequest('GET', '/api/v1/auth/me');
            checks.apiKey = row('ok', 'API key accepted.');
            checks.seerr = row('ok', 'Seerr is reachable.');
          } catch (error) {
            checks.apiKey = [401, 403].includes(error.status)
              ? row('error', 'API key rejected or lacks access. Replace it in Settings.', 'apiKey')
              : row('warning', 'Could not verify the API key. Check the Seerr connection and retry.', 'apiKey');
          }
        })(),
        (async () => {
          if (!this.plexToken) { checks.plex = row('warning', 'No Plex token. Plex watchlist is optional.', 'plexToken'); return; }
          const allowed = await chrome.permissions.contains({ origins: ['https://plex.tv/*', 'https://discover.provider.plex.tv/*', 'https://metadata.provider.plex.tv/*'] });
          if (!allowed) { checks.plex = row('error', 'Plex host access is missing. Save the token in Settings to grant access.', 'plexToken'); return; }
          try { await this.plexTestConnection(); checks.plex = row('ok', 'Plex account connection verified.'); }
          catch (_) { checks.plex = row('error', 'Plex connection failed. Check the token and network, then test again.', 'plexToken'); }
        })()
      ]);
      return result;
    }
  };
})(globalThis);

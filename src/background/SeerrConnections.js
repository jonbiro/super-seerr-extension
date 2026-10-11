// Saved sites and their credentials are a single device-local record, so a
// switch can never pair one site's URL with another site's API key.
(function (root) {
  const KEY = 'seerrConnectionsV1';
  const MAX_SITES = 10;
  const normalize = value => {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('Use an HTTP(S) server URL without credentials, query parameters, or fragments');
    }
    return url.href.replace(/\/+$/, '');
  };
  root.SeerrConnections = {
    async readSeerrConnections() {
      const stored = (await chrome.storage.local.get(KEY))[KEY];
      if (stored) {
        if (!Array.isArray(stored.sites) || !stored.sites.some(site => site.id === stored.activeId)) {
          throw new Error('Saved sites could not be loaded');
        }
        return JSON.parse(JSON.stringify(stored));
      }
      const [synced, local] = await Promise.all([
        chrome.storage.sync.get('seerrUrl'), chrome.storage.local.get('seerrApiKey')
      ]);
      const url = synced.seerrUrl ? normalize(synced.seerrUrl) : null;
      return { revision: 0, activeId: url, sites: url ? [{ id: url, url, name: new URL(url).host, apiKey: local.seerrApiKey || '' }] : [] };
    },
    publicSeerrConnections(value) {
      return { revision: value.revision, activeId: value.activeId, maxSites: MAX_SITES, sites: value.sites.map(({ id, name, url }) => ({ id, name, url })) };
    },
    connectionToken() {
      return this.connections ? `${this.connections.revision}:${this.connections.activeId}` : this.baseUrl ?? null;
    },
    seerrConnectionGuard() {
      const server = this.baseUrl, apiKey = this.apiKey, token = this.connectionToken();
      return () => {
        if (this.baseUrl !== server || this.apiKey !== apiKey || this.connectionToken() !== token) {
          throw new Error('Active Seerr site changed. Refresh the title and review it again.');
        }
      };
    },
    async currentSeerrSender(sender) {
      if (!Number.isInteger(sender?.tab?.id) || (sender.frameId ?? 0) !== 0 || !chrome.tabs?.get) return sender;
      let original;
      try { original = new URL(sender.url); } catch (_) { return sender; }
      const sites = this.connections?.sites || (this.baseUrl ? [{ url: this.baseUrl }] : []);
      if (!sites.some(site => new URL(site.url).origin === original.origin)) return sender;
      // MessageSender.url can remain the original document URL after pushState.
      // The browser's tab URL determines which installation owns this message.
      const tab = await chrome.tabs.get(sender.tab.id);
      if (!tab.url || new URL(tab.url).origin !== original.origin) {
        throw new Error('The Seerr page changed. Reload it before trying again.');
      }
      return { ...sender, url: tab.url };
    },
    async connectionOperation(action, data, sender) {
      this.requireExtensionPage(sender);
      if (action === 'getSeerrConnections') {
        await this.connectionChangePending;
        return this.publicSeerrConnections(await this.readSeerrConnections());
      }
      const operation = (this.connectionChangePending || Promise.resolve()).then(async () => {
        const value = await this.readSeerrConnections();
        if (action === 'saveSeerrConnection') {
          const url = normalize(data?.url);
          const previous = data?.id ? value.sites.find(site => site.id === data.id) : null;
          if (data?.id && !previous) throw new Error('This site was removed. Reload Settings.');
          if (value.sites.some(site => site.url === url && site !== previous)) throw new Error('This site is already saved. Select it from Saved sites.');
          if (!previous && value.sites.length >= MAX_SITES) throw new Error(`You can save up to ${MAX_SITES} Seerr sites.`);
          const name = String(data?.name || new URL(url).host).trim().slice(0, 80);
          const site = { id: url, url, name: name || new URL(url).host, apiKey: String(data?.apiKey || '').trim() };
          value.sites = previous ? value.sites.map(item => item === previous ? site : item) : [...value.sites, site];
          value.activeId = site.id;
        } else if (action === 'activateSeerrConnection') {
          if (!value.sites.some(site => site.id === data?.id)) throw new Error('This site was removed. Reload Settings.');
          value.activeId = data.id;
        } else if (action === 'removeSeerrConnection') {
          if (value.activeId === data?.id) throw new Error('Switch to another site before removing this one.');
          value.sites = value.sites.filter(site => site.id !== data?.id);
        } else throw new Error('Unknown site operation');
        value.revision = (value.revision || 0) + 1;
        await chrome.storage.local.set({ [KEY]: value, seerrApiKey: '' });
        // Commit the matching pair in memory too, before another async read.
        // A settings-read failure after persistence must not leave the previous
        // server receiving requests while the picker reports the new one.
        this.connections = value;
        const active = value.sites.find(site => site.id === value.activeId);
        this.baseUrl = active.url;
        this.apiKey = active.apiKey;
        this.invalidateSeerrReads();
        await this.loadSettings();
        await this.syncOverlayRegistration();
        await this.notifyContentState();
        return this.publicSeerrConnections(value);
      });
      this.connectionChangePending = operation.catch(() => {});
      return operation;
    },
    savedSiteForPage(sender) {
      if (!this.connections || !sender?.url) return null;
      let page;
      try { page = new URL(sender.url); } catch (_) { return null; }
      const matches = this.connections.sites.filter(site => {
        const url = new URL(site.url), base = url.pathname.replace(/\/+$/, '');
        return page.origin === url.origin && (page.pathname === base || page.pathname.startsWith(`${base}/`));
      }).sort((a, b) => b.url.length - a.url.length);
      return matches[0] || null;
    },
    isInactiveSeerrPage(sender) {
      const site = this.savedSiteForPage(sender);
      return !!site && site.id !== this.connections.activeId;
    },
    assertConnectionTarget(request, sender) {
      if (request.connectionToken !== undefined && request.connectionToken !== this.connectionToken()) {
        throw new Error('Active Seerr site changed. Refresh the title and review it again.');
      }
      // Choose the most specific saved base path before granting access to a
      // parent installation on the same origin.
      if (this.isInactiveSeerrPage(sender)) {
        throw new Error('This is not the active Seerr site. Switch sites in the extension popup first.');
      }
    }
  };
})(globalThis);

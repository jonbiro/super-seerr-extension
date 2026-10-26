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
  const sanitize = stored => {
    if (!stored || typeof stored !== 'object' || !Array.isArray(stored.sites) || stored.sites.length === 0 || stored.sites.length > MAX_SITES || typeof stored.activeId !== 'string') {
      throw new Error('Saved sites could not be loaded');
    }
    const ids = new Set();
    const urls = new Set();
    const sites = stored.sites.map(site => {
      if (!site || typeof site !== 'object' || typeof site.id !== 'string' || typeof site.url !== 'string') {
        throw new Error('Saved sites could not be loaded');
      }
      let url;
      try { url = normalize(site.url); } catch (_) { throw new Error('Saved sites could not be loaded'); }
      if (!site.id || ids.has(site.id) || urls.has(url) || (site.apiKey !== undefined && typeof site.apiKey !== 'string')) {
        throw new Error('Saved sites could not be loaded');
      }
      ids.add(site.id);
      urls.add(url);
      return { id: site.id, url, name: typeof site.name === 'string' ? site.name.slice(0, 80) : new URL(url).host, apiKey: site.apiKey || '' };
    });
    if (!sites.some(site => site.id === stored.activeId)) throw new Error('Saved sites could not be loaded');
    return { revision: Number.isSafeInteger(stored.revision) && stored.revision >= 0 ? stored.revision : 0, activeId: stored.activeId, sites };
  };
  root.SeerrConnections = {
    async readSeerrConnections() {
      const stored = (await chrome.storage.local.get(KEY))[KEY];
      if (stored !== undefined && stored !== null) {
        return sanitize(stored);
      }
      const [synced, local] = await Promise.all([
        chrome.storage.sync.get('seerrUrl'), chrome.storage.local.get('seerrApiKey')
      ]);
      const url = synced.seerrUrl ? normalize(synced.seerrUrl) : null;
      return { revision: 0, activeId: url, sites: url ? [{ id: url, url, name: new URL(url).host, apiKey: local.seerrApiKey || '' }] : [] };
    },
    sanitizeSavedConnections: sanitize,
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
      const sites = this.savedSites();
      if (!sites.some(site => {
        try { return new URL(site.url).origin === original.origin; } catch (_) { return false; }
      })) return sender;
      // MessageSender.url can remain the original document URL after pushState.
      // The browser's tab URL determines which installation owns this message.
      const tab = await chrome.tabs.get(sender.tab.id);
      let current;
      try { current = new URL(tab.url); } catch (_) { current = null; }
      if (!current || current.origin !== original.origin || !this.savedSiteForPage({ ...sender, url: current.href })) {
        throw new Error('The Seerr page changed. Reload it before trying again.');
      }
      return { ...sender, url: current.href };
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
          if (!value.sites.some(site => site.id === data?.id)) throw new Error('This site was removed. Reload Settings.');
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
    savedSites() {
      const sites = Array.isArray(this.connections?.sites)
        ? this.connections.sites
        : this.baseUrl ? [{ id: this.baseUrl, url: this.baseUrl }] : [];
      return sites.filter(site => site && typeof site.url === 'string');
    },
    savedSiteForPage(sender) {
      if (!sender?.url) return null;
      let page;
      try { page = new URL(sender.url); } catch (_) { return null; }
      const matches = this.savedSites().filter(site => {
        let url;
        try { url = new URL(site.url); } catch (_) { return false; }
        const base = url.pathname.replace(/\/+$/, '');
        return page.origin === url.origin && (page.pathname === base || page.pathname.startsWith(`${base}/`));
      }).sort((a, b) => b.url.length - a.url.length);
      return matches[0] || null;
    },
    isInactiveSeerrPage(sender) {
      const site = this.savedSiteForPage(sender);
      // A legacy single-site install has no profile container; its virtual
      // site is the active site by definition.
      return !!site && !!this.connections && site.id !== this.connections.activeId;
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

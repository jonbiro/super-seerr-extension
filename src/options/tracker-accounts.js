// Account tokens remain in the worker; Settings receives public connection state.
(function () {
  const PROVIDERS = [
    { id: 'trakt', name: 'Trakt', register: 'https://developer.trakt.tv/apps', origins: ['https://api.trakt.tv/*', 'https://auth.trakt.tv/*'] },
    { id: 'simkl', name: 'Simkl', register: 'https://simkl.com/settings/developer/', origins: ['https://api.simkl.com/*', 'https://simkl.com/*'] }
  ];
  const element = (tag, properties = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(properties)) {
      if (key === 'textContent' || key === 'className') node[key] = value;
      else node.setAttribute(key, value);
    }
    node.append(...children);
    return node;
  };

  class TrackerAccounts {
    constructor(root) {
      this.root = root;
      this.cards = new Map();
      this.readGeneration = 0;
      this.accountsRefreshPending = false;
      root.append(element('h2', { id: 'trackerAccountsHeading', textContent: 'Trakt & Simkl watchlists' }),
        element('p', { textContent: 'Connect your own app to read its watchlist when you choose Sync. Sync imports titles into this review only; it does not change your provider watchlist or send Seerr requests. Find a title in Seerr to review availability and request it separately. Account tokens stay on this device.' }));
      this.status = element('p', { className: 'tracker-section-status', role: 'status' });
      this.retry = element('button', { type: 'button', className: 'button secondary', textContent: 'Reload account connections' });
      this.retry.addEventListener('click', () => this.loadAccounts());
      root.append(this.status, this.retry);
      for (const provider of PROVIDERS) this.createCard(provider);
      chrome.storage?.onChanged?.addListener((changes, area) => {
        if (area !== 'local' || !Object.prototype.hasOwnProperty.call(changes, 'trackerAccountsV1')) return;
        // Inspect public state only. Token rotations and last-sync stamps do
        // not replace an account or invalidate the list currently being read.
        this.loadAccounts({ invalidateLists: false });
      });
      window.addEventListener('pageshow', event => {
        if (event.persisted) this.loadAccounts({ invalidateLists: false });
      });
      this.loadAccounts();
    }

    createCard(provider) {
      const card = { provider, account: null, generation: 0, watchGeneration: 0, busy: null, loading: false, syncPermission: false, items: [], nextPage: null, skipped: 0 };
      const fieldset = element('fieldset', { className: 'tracker-account', 'data-tracker': provider.id });
      const id = `tracker-${provider.id}`;
      card.input = element('input', { id: `${id}-client`, type: 'text', autocomplete: 'off', spellcheck: 'false', maxlength: '256' });
      card.callback = element('textarea', { id: `${id}-callback`, readonly: '', rows: '3', spellcheck: 'false' });
      card.summary = element('p', { className: 'tracker-account-summary', role: 'status' });
      card.status = element('p', { className: 'tracker-account-status', role: 'status', 'aria-live': 'polite' });
      const registration = element('a', { href: provider.register, target: '_blank', rel: 'noopener noreferrer', textContent: `Register a ${provider.name} app` });
      const guidance = element('p', { className: 'tracker-help', textContent: provider.id === 'simkl'
        ? 'Register under “Mobile, desktop & browser apps” and choose AUTH V2. Copy the callback URL below into its redirect URI, and paste its Client ID. A client secret is not needed.'
        : 'Register a public app, copy the callback URL below into its redirect URI, and paste its Client ID. A client secret is not needed.' });
      const callbackLabel = element('label', { for: `${id}-callback`, textContent: 'Callback URL for this browser' });
      card.save = element('button', { type: 'button', className: 'button secondary', textContent: 'Save app' });
      card.connect = element('button', { type: 'button', className: 'button primary', textContent: `Connect ${provider.name}` });
      card.disconnect = element('button', { type: 'button', className: 'button secondary', textContent: 'Disconnect' });
      card.sync = element('button', { type: 'button', className: 'button secondary', textContent: 'Sync watchlist' });
      card.more = element('button', { type: 'button', className: 'button secondary', textContent: 'Load more titles', hidden: '' });
      card.list = element('ul', { className: 'tracker-watchlist', 'aria-label': `${provider.name} watchlist titles` });
      const controls = element('div', { className: 'tracker-account-actions' }, [card.save, card.connect, card.disconnect, card.sync]);
      fieldset.append(element('legend', { textContent: provider.name }), registration, guidance,
        element('label', { for: `${id}-client`, textContent: `${provider.name} Client ID` }), card.input,
        callbackLabel, card.callback, card.summary, controls, card.status, card.list, card.more);
      this.root.append(fieldset);
      card.root = fieldset;
      card.input.addEventListener('input', () => this.updateControls(card));
      card.save.addEventListener('click', () => this.save(card));
      card.connect.addEventListener('click', () => this.connect(card));
      card.disconnect.addEventListener('click', () => this.disconnect(card));
      card.sync.addEventListener('click', () => this.syncWatchlist(card));
      card.more.addEventListener('click', () => this.loadWatchlist(card, card.nextPage));
      this.cards.set(provider.id, card);
      this.updateControls(card);
    }

    async message(action, data) {
      const response = await chrome.runtime.sendMessage({ action, ...(data ? { data } : {}) });
      if (!response?.success) throw new Error(response?.error || 'The extension did not reply. Try again.');
      return response.data;
    }

    validAccount(account, provider) {
      return account?.provider === provider && typeof account.clientId === 'string' && typeof account.connected === 'boolean' && typeof account.callbackUrl === 'string';
    }

    applyAccount(card, accounts, resetDraft = false) {
      const account = Array.isArray(accounts) && accounts.find(item => this.validAccount(item, card.provider.id));
      if (!account) throw new Error('Could not read this account connection. Reload account connections.');
      if (card.account && (card.account.clientId !== account.clientId || card.account.accountRevision !== account.accountRevision || (card.account.connected && !account.connected))) {
        card.watchGeneration++;
        card.loading = false;
        card.syncPermission = false;
        this.clearWatchlist(card);
      }
      card.account = account;
      if (resetDraft) card.input.value = account.clientId;
      card.callback.value = account.callbackUrl;
      this.updateControls(card);
    }

    async loadAccounts({ invalidateLists = true } = {}) {
      if ([...this.cards.values()].some(card => card.busy)) {
        this.accountsRefreshPending = true;
        return;
      }
      if (invalidateLists) for (const card of this.cards.values()) {
        card.watchGeneration++;
        card.loading = false;
        card.syncPermission = false;
        this.clearWatchlist(card);
        card.status.textContent = '';
        this.updateControls(card);
      }
      const generation = ++this.readGeneration;
      this.retry.disabled = true;
      this.status.textContent = 'Loading account connections…';
      try {
        const accounts = await this.message('getTrackerAccounts');
        if (generation !== this.readGeneration) return;
        for (const card of this.cards.values()) this.applyAccount(card, accounts, !card.account);
        this.status.textContent = '';
      } catch (error) {
        if (generation !== this.readGeneration) return;
        this.status.textContent = error.message;
      } finally {
        if (generation === this.readGeneration) this.retry.disabled = false;
      }
    }

    updateControls(card) {
      const unavailable = !card.account;
      const dirty = card.input.value.trim() !== card.account?.clientId;
      card.input.disabled = unavailable || !!card.busy || card.syncPermission;
      card.save.disabled = unavailable || !!card.busy || card.syncPermission || !card.input.value.trim() || !dirty;
      card.connect.disabled = unavailable || !!card.busy || card.syncPermission || dirty || !card.account.clientId || card.account.connected;
      card.connect.textContent = card.busy === 'connecting' ? `Connecting ${card.provider.name}…`
        : card.account?.connected ? `Connected to ${card.provider.name}` : `Connect ${card.provider.name}`;
      card.disconnect.disabled = unavailable || card.busy === 'saving' || card.busy === 'disconnecting' || (!card.account.connected && card.busy !== 'connecting');
      card.disconnect.textContent = card.busy === 'connecting' ? 'Cancel connection' : 'Disconnect';
      card.sync.disabled = unavailable || !card.account.connected || !!card.busy || card.loading || card.syncPermission;
      card.more.disabled = card.sync.disabled || !card.nextPage;
      card.more.hidden = !card.nextPage;
      card.list.setAttribute('aria-busy', String(card.loading));
      if (!card.account) card.summary.textContent = 'Connection state unavailable.';
      else if (card.busy === 'connecting') card.summary.textContent = 'Waiting for account authorization…';
      else if (card.busy === 'disconnecting') card.summary.textContent = 'Disconnecting…';
      else {
        const checked = Number.isFinite(card.account.lastSyncAt) && card.account.lastSyncAt > 0
          ? ` Last synced ${new Date(card.account.lastSyncAt).toLocaleString()}.` : '';
        card.summary.textContent = `${card.account.connected ? 'Connected.' : 'Not connected.'}${checked}${dirty ? ' Save the edited Client ID before connecting.' : ''}`;
      }
    }

    begin(card, busy) {
      this.readGeneration++;
      this.retry.disabled = true;
      card.generation++;
      card.watchGeneration++;
      card.loading = false;
      card.syncPermission = false;
      card.busy = busy;
      card.status.textContent = '';
      this.clearWatchlist(card);
      this.updateControls(card);
      return card.generation;
    }

    finish(card, generation) {
      if (card.generation !== generation) return;
      card.busy = null;
      this.retry.disabled = [...this.cards.values()].some(item => item.busy);
      this.updateControls(card);
      if (this.accountsRefreshPending && !this.retry.disabled) {
        this.accountsRefreshPending = false;
        this.loadAccounts({ invalidateLists: false });
      }
    }

    async save(card) {
      if (card.save.disabled) return;
      const clientId = card.input.value.trim();
      const generation = this.begin(card, 'saving');
      try {
        const accounts = await this.message('saveTrackerApp', { provider: card.provider.id, clientId });
        if (generation !== card.generation) return;
        this.applyAccount(card, accounts, true);
        card.status.textContent = 'App saved. Choose Connect to authorize your account.';
      } catch (error) {
        if (generation === card.generation) card.status.textContent = error.message;
      } finally { this.finish(card, generation); }
    }

    async connect(card) {
      if (card.connect.disabled) return;
      const generation = this.begin(card, 'connecting');
      try {
        // The optional permission prompt must begin in this click's user gesture.
        const granted = await chrome.permissions.request({ origins: card.provider.origins });
        if (generation !== card.generation) return;
        if (!granted) throw new Error('Site access was not granted. Choose Connect to try again.');
        const accounts = await this.message('connectTracker', { provider: card.provider.id });
        if (generation !== card.generation) return;
        this.applyAccount(card, accounts);
        card.status.textContent = 'Account connected. Choose Sync watchlist to read your titles.';
      } catch (error) {
        if (generation === card.generation) card.status.textContent = error.message;
      } finally { this.finish(card, generation); }
    }

    async disconnect(card) {
      if (card.disconnect.disabled) return;
      const generation = this.begin(card, 'disconnecting');
      try {
        const accounts = await this.message('disconnectTracker', { provider: card.provider.id });
        if (generation !== card.generation) return;
        this.applyAccount(card, accounts);
        card.status.textContent = 'Disconnected on this device. Your provider watchlist was not changed.';
      } catch (error) {
        if (generation === card.generation) card.status.textContent = error.message;
      } finally { this.finish(card, generation); }
    }

    clearWatchlist(card) {
      card.items = [];
      card.nextPage = null;
      card.skipped = 0;
      card.list.replaceChildren();
    }

    async syncWatchlist(card) {
      if (card.sync.disabled) return;
      const generation = card.watchGeneration;
      card.syncPermission = true;
      card.status.textContent = 'Checking site access…';
      this.updateControls(card);
      try {
        // Sync also restores revoked host access without disconnecting the account.
        const granted = await chrome.permissions.request({ origins: card.provider.origins });
        if (generation !== card.watchGeneration || !card.account.connected) return;
        if (!granted) throw new Error('Site access was not granted. Choose Sync watchlist to try again.');
        card.syncPermission = false;
        this.updateControls(card);
        await this.loadWatchlist(card, 1);
      } catch (error) {
        if (generation === card.watchGeneration) card.status.textContent = error.message;
      } finally {
        if (generation === card.watchGeneration) {
          card.syncPermission = false;
          this.updateControls(card);
        }
      }
    }

    async loadWatchlist(card, page) {
      if (card.sync.disabled || !Number.isInteger(page) || page < 1 || page > 5) return;
      const generation = ++card.watchGeneration;
      if (page === 1) this.clearWatchlist(card);
      card.loading = true;
      card.status.textContent = 'Reading watchlist…';
      this.updateControls(card);
      try {
        const data = await this.message('getTrackerWatchlist', { provider: card.provider.id, page });
        if (generation !== card.watchGeneration || !card.account.connected) return;
        if (data?.provider !== card.provider.id || data.page !== page || !Array.isArray(data.items)) throw new Error('The provider returned an unreadable watchlist. Try Sync watchlist again.');
        const items = data.items.filter(item => typeof item?.title === 'string' && item.title.trim() && ['movie', 'tv'].includes(item.mediaType));
        card.items.push(...items.slice(0, 500 - card.items.length));
        card.nextPage = Number.isInteger(data.nextPage) && data.nextPage > page && data.nextPage <= 5 && card.items.length < 500 ? data.nextPage : null;
        card.skipped += Math.max(0, Number(data.skipped) || 0) + data.items.length - items.length;
        if (Number.isFinite(data.lastSyncAt)) card.account.lastSyncAt = data.lastSyncAt;
        this.renderWatchlist(card);
        card.status.textContent = `${card.items.length ? `${card.items.length} ${card.items.length === 1 ? 'title' : 'titles'} loaded for review.` : 'Your watchlist has no supported movie or TV titles.'}${card.skipped ? ` ${card.skipped} unsupported ${card.skipped === 1 ? 'entry' : 'entries'} skipped.` : ''}${data.truncated || (data.hasMore && !card.nextPage) ? ' More titles may be available on the provider; this review is limited to 500 titles.' : ''}`;
      } catch (error) {
        if (generation === card.watchGeneration) card.status.textContent = error.message;
      } finally {
        if (generation === card.watchGeneration) {
          card.loading = false;
          this.updateControls(card);
        }
      }
    }

    renderWatchlist(card) {
      card.list.replaceChildren();
      for (const item of card.items) {
        const title = element('strong', { textContent: item.title });
        const details = element('span', { textContent: `${item.year || 'Year unknown'} · ${item.mediaType === 'tv' ? 'TV series' : 'Movie'}` });
        const find = element('button', { type: 'button', className: 'button secondary', textContent: 'Find in Seerr', 'aria-label': `Find ${item.title} in Seerr` });
        find.addEventListener('click', () => this.findInSeerr(card, item, find));
        card.list.append(element('li', {}, [element('div', { className: 'tracker-title-info' }, [title, details]), find]));
      }
    }

    async findInSeerr(card, item, button) {
      if (button.disabled || !card.account?.connected) return;
      const generation = card.watchGeneration;
      button.disabled = true;
      try {
        // Read the active destination at activation time, never from an old sync.
        const config = await this.message('getConfigState');
        if (generation !== card.watchGeneration || !card.account.connected) return;
        if (typeof config?.serverUrl !== 'string' || !config.serverUrl) throw new Error('Save a Seerr server URL in Settings first.');
        const url = new URL(config.serverUrl);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Save a valid Seerr server URL in Settings first.');
        url.pathname = `${url.pathname.replace(/\/$/, '')}/search`;
        url.searchParams.set('query', item.title);
        await chrome.tabs.create({ url: url.href });
      } catch (error) {
        if (generation === card.watchGeneration) card.status.textContent = error.message;
      } finally { if (button.isConnected) button.disabled = false; }
    }
  }

  window.TrackerAccounts = TrackerAccounts;
  const initialize = () => {
    const root = document.getElementById('trackerAccounts');
    if (root && !root.dataset.initialized) {
      root.dataset.initialized = 'true';
      window.trackerAccounts = new TrackerAccounts(root);
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();

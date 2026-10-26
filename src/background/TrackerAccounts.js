// Optional, user-initiated tracker reads. Tokens never leave the worker.
(function (root) {
  const KEY = 'trackerAccountsV1';
  const SNAPSHOTS_KEY = 'simklWatchlistSnapshotsV1';
  const MAX_SNAPSHOTS = 10, MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
  const PAGE_SIZE = 100, MAX_ITEMS = 500, MAX_BODY = 2 * 1024 * 1024;
  const PROVIDERS = {
    trakt: { name: 'Trakt', authorize: 'https://auth.trakt.tv/oauth/authorize', token: 'https://auth.trakt.tv/oauth/token', origin: 'https://api.trakt.tv' },
    simkl: { name: 'Simkl', authorize: 'https://simkl.com/oauth2/authorize', token: 'https://api.simkl.com/oauth2/token', origin: 'https://api.simkl.com' }
  };
  function providerOf(value) {
    if (value !== 'trakt' && value !== 'simkl') throw new Error('Choose a supported tracker');
    return value;
  }
  const random = () => [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const opaque = value => typeof value === 'string' && value.length > 0 && value.length <= 8192 && !/[\s\u0000-\u001f\u007f]/.test(value);
  const snapshotIdOf = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const sameAccount = (current, account) => current && current.clientId === account.clientId &&
    current.accessToken === account.accessToken && current.refreshToken === account.refreshToken && current.accountRevision === account.accountRevision;
  const sameReviewAccount = (current, account) => sameAccount(current, account) ||
    (current && opaque(account.accountRevision) && current.accountRevision === account.accountRevision &&
      current.clientId === account.clientId && opaque(current.accessToken) && opaque(current.refreshToken));
  const snapshotBytes = snapshots => new TextEncoder().encode(JSON.stringify({ version: 1, snapshots })).byteLength;
  function boundSnapshots(records) {
    const snapshots = records.filter(record => snapshotBytes([record]) <= MAX_SNAPSHOT_BYTES).slice(-MAX_SNAPSHOTS);
    while (snapshotBytes(snapshots) > MAX_SNAPSHOT_BYTES) snapshots.shift();
    return snapshots;
  }
  function clientIdOf(value) {
    if (typeof value !== 'string' || !/^[\x21-\x7e]{1,256}$/.test(value.trim())) throw new Error('Enter a valid application client ID');
    return value.trim();
  }
  function normalize(row, provider, anime = false) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    if (provider === 'simkl' && row.status !== 'plantowatch') return null;
    const mediaType = anime ? (row.anime_type === 'movie' ? 'movie' : row.anime_type === 'tv' ? 'tv' : null)
      : row.movie && (provider !== 'trakt' || row.type === 'movie') ? 'movie'
      : row.show && (provider !== 'trakt' || row.type === 'show') ? 'tv' : null;
    if (!mediaType || (!anime && row.anime_type) || row.episode || row.season) return null;
    const media = anime ? row.show : mediaType === 'movie' ? row.movie : row.show;
    if (!media || typeof media.title !== 'string') return null;
    const title = media.title.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    if (!title || title.length > 300) return null;
    let year = null;
    if (media.year != null) {
      if (!['number', 'string'].includes(typeof media.year) || !/^[0-9]{4}$/.test(String(media.year)) || Number(media.year) < 1800 || Number(media.year) > new Date().getFullYear() + 10) return null;
      year = Number(media.year);
    }
    const result = { title, mediaType, year };
    const tmdb = media.ids?.tmdb;
    // Simkl anime movies may carry a parent TV show's TMDB ID. Resolve these
    // by title/type/year rather than treating that untyped ID as movie evidence.
    if (!anime && (typeof tmdb === 'number' || (typeof tmdb === 'string' && /^\d+$/.test(tmdb))) && Number.isSafeInteger(Number(tmdb)) && Number(tmdb) > 0) result.tmdbId = Number(tmdb);
    const imdb = media.ids?.imdb;
    if (typeof imdb === 'string' && /^tt\d{5,12}$/.test(imdb)) result.imdbId = imdb;
    return result;
  }
  root.TrackerAccounts = {
    trackerEpoch(provider) { return this.trackerEpochs?.[provider] || 0; },
    invalidateTracker(provider) {
      this.trackerEpochs ??= {};
      this.trackerEpochs[provider] = this.trackerEpoch(provider) + 1;
      if (provider === 'simkl') {
        this.simklReviewState = null;
        // Serialize removal behind any older snapshot write and ahead of the
        // account mutation. Account binding still rejects retired data if a
        // browser storage failure prevents best-effort cache removal.
        this.queueTrackerStorage(async () => {
          await chrome.storage.session?.remove(SNAPSHOTS_KEY);
        }).catch(() => {});
      }
      return this.trackerEpoch(provider);
    },
    async readTrackerAccounts() {
      await this.trackerStorageQueue;
      const value = (await chrome.storage.local.get(KEY))[KEY];
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    },
    queueTrackerStorage(operation) {
      const task = (this.trackerStorageQueue || Promise.resolve()).then(operation);
      this.trackerStorageQueue = task.catch(() => {});
      return task;
    },
    async commitTracker(provider, epoch, updater) {
      return this.queueTrackerStorage(async () => {
        this.assertTrackerEpoch(provider, epoch);
        const stored = (await chrome.storage.local.get(KEY))[KEY];
        this.assertTrackerEpoch(provider, epoch);
        const accounts = stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...stored } : {};
        accounts[provider] = updater(accounts[provider] || {});
        this.assertTrackerEpoch(provider, epoch);
        await chrome.storage.local.set({ [KEY]: accounts });
        this.assertTrackerEpoch(provider, epoch);
        return accounts[provider];
      });
    },
    assertTrackerEpoch(provider, epoch) {
      if (this.trackerEpoch(provider) !== epoch) throw new Error('Tracker account changed. Try again.');
    },
    async assertTrackerSnapshot(provider, epoch, account, { allowTokenRotation = false } = {}) {
      this.assertTrackerEpoch(provider, epoch);
      const current = (await this.readTrackerAccounts())[provider];
      this.assertTrackerEpoch(provider, epoch);
      if (!(allowTokenRotation ? sameReviewAccount(current, account) : sameAccount(current, account))) throw new Error('Tracker account changed. Try again.');
      return current;
    },
    async withSimklSnapshots(epoch, account, operation) {
      // Current accounts have a stable revision across rotating tokens. For
      // legacy records, hash the token rather than copying it into this cache.
      const identity = JSON.stringify([account.clientId, opaque(account.accountRevision) ? account.accountRevision : account.accessToken]);
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity)));
      const accountKey = [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
      return this.queueTrackerStorage(async () => {
        this.assertTrackerEpoch('simkl', epoch);
        const current = (await chrome.storage.local.get(KEY))[KEY]?.simkl;
        this.assertTrackerEpoch('simkl', epoch);
        if (!sameReviewAccount(current, account)) throw new Error('Tracker account changed. Try again.');
        const stored = chrome.storage.session?.get
          ? (await chrome.storage.session.get(SNAPSHOTS_KEY))[SNAPSHOTS_KEY] : this.simklReviewState;
        const records = [];
        if (stored?.version === 1 && Array.isArray(stored.snapshots)) for (const record of stored.snapshots) {
          if (record?.accountKey !== accountKey || !snapshotIdOf(record.id) ||
              !(record.activity === null || typeof record.activity === 'string') ||
              !Array.isArray(record.items) || record.items.length > MAX_ITEMS) continue;
          const items = record.items.map(item => {
            if (!item || !['movie', 'tv'].includes(item.mediaType)) return null;
            return normalize({ status: 'plantowatch', [item.mediaType === 'movie' ? 'movie' : 'show']:
              { title: item.title, year: item.year, ids: { tmdb: item.tmdbId, imdb: item.imdbId } } }, 'simkl');
          });
          if (items.some(item => !item)) continue;
          records.push({ id: record.id, accountKey, activity: record.activity, items,
            skipped: Number.isSafeInteger(record.skipped) && record.skipped >= 0 ? record.skipped : 0,
            truncated: record.truncated === true });
        }
        this.assertTrackerEpoch('simkl', epoch);
        const result = operation(boundSnapshots(records), accountKey);
        if (result.snapshots) {
          const snapshots = boundSnapshots(result.snapshots);
          if (!snapshots.some(record => record.id === result.value?.id)) throw new Error('The Simkl review is too large to retain. Try a smaller watchlist.');
          const state = { version: 1, snapshots };
          this.assertTrackerEpoch('simkl', epoch);
          if (chrome.storage.session?.set) await chrome.storage.session.set({ [SNAPSHOTS_KEY]: state });
          else this.simklReviewState = state;
        }
        this.assertTrackerEpoch('simkl', epoch);
        return result.value;
      });
    },
    findSimklSnapshot(epoch, account, { id, activity }) {
      return this.withSimklSnapshots(epoch, account, records => ({ value: [...records].reverse().find(record => id
        ? record.id === id : !record.truncated && record.activity === activity) || null }));
    },
    saveSimklSnapshot(epoch, account, snapshot) {
      return this.withSimklSnapshots(epoch, account, (records, accountKey) => {
        const existing = [...records].reverse().find(record => !record.truncated && record.activity === snapshot.activity);
        if (existing) return { value: existing };
        const record = { ...snapshot, id: random(), accountKey };
        return { value: record, snapshots: [...records, record] };
      });
    },
    trackerCallback(provider) { return chrome.identity.getRedirectURL(`tracker/${provider}`); },
    async publicTrackerAccounts() {
      const accounts = await this.readTrackerAccounts();
      return Object.entries(PROVIDERS).map(([provider, config]) => {
        const account = accounts[provider] || {};
        return { provider, name: config.name, clientId: typeof account.clientId === 'string' ? account.clientId : '',
          connected: opaque(account.accessToken) && opaque(account.refreshToken), callbackUrl: this.trackerCallback(provider),
          accountRevision: typeof account.accountRevision === 'string' ? account.accountRevision : '',
          lastSyncAt: Number.isFinite(account.lastSyncAt) ? account.lastSyncAt : null,
          expiresAt: Number.isFinite(account.expiresAt) ? account.expiresAt : null };
      });
    },
    async trackerPermission(provider) {
      const config = PROVIDERS[provider];
      const origins = [...new Set([config.origin, new URL(config.authorize).origin, new URL(config.token).origin])].map(origin => `${origin}/*`);
      if (!await chrome.permissions.contains({ origins })) throw new Error(`Grant ${config.name} access in Settings before connecting.`);
    },
    async trackerFetch(provider, url, options = {}) {
      const remaining = (this.trackerBackoffUntil?.[provider] || 0) - Date.now();
      if (remaining > 0) throw new Error(`${PROVIDERS[provider].name} is rate limited. Try again in ${Math.ceil(remaining / 1000)} seconds.`);
      let response;
      try {
        response = await fetch(url, { ...options, credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
      } catch (_) { throw new Error(`${PROVIDERS[provider].name} could not be reached. Try again.`); }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        if (response.status === 429) {
          const retry = response.headers.get('Retry-After');
          const seconds = typeof retry === 'string' && /^\d+$/.test(retry) ? Math.max(1, Math.min(3600, Number(retry))) : 15;
          this.trackerBackoffUntil ??= {};
          this.trackerBackoffUntil[provider] = Date.now() + seconds * 1000;
          throw new Error(`${PROVIDERS[provider].name} is rate limited. Try again in ${seconds} seconds.`);
        }
        throw new Error(`${PROVIDERS[provider].name} returned HTTP ${response.status}. Check the connection or reconnect.`);
      }
      let body;
      const oversized = () => new Error(`${PROVIDERS[provider].name} returned too many items for one import.`);
      if (Number(response.headers.get('Content-Length')) > MAX_BODY) {
        await response.body?.cancel().catch(() => {});
        throw oversized();
      }
      if (response.body?.getReader) {
        const reader = response.body.getReader(), chunks = [];
        let size = 0;
        let cancelled = false;
        const cancelReader = async () => {
          if (cancelled) return;
          cancelled = true;
          await reader.cancel().catch(() => {});
        };
        try {
          while (true) {
            let part;
            try { part = await reader.read(); }
            catch (_) { await cancelReader(); throw new Error(`${PROVIDERS[provider].name} returned an unreadable response.`); }
            if (part.done) break;
            size += part.value.byteLength;
            if (size > MAX_BODY) { await cancelReader(); throw oversized(); }
            chunks.push(part.value);
          }
        } finally { reader.releaseLock(); }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        body = new TextDecoder().decode(bytes);
      } else {
        try { body = await response.text(); } catch (_) { throw new Error(`${PROVIDERS[provider].name} returned an unreadable response.`); }
        if (body.length > MAX_BODY) throw oversized();
      }
      try { return { data: JSON.parse(body), headers: response.headers }; }
      catch (_) { throw new Error(`${PROVIDERS[provider].name} returned an invalid response.`); }
    },
    async exchangeTrackerToken(provider, fields, previous = null) {
      const config = PROVIDERS[provider];
      const form = provider === 'simkl';
      const { data } = await this.trackerFetch(provider, config.token, {
        method: 'POST', headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
        body: form ? new URLSearchParams(fields).toString() : JSON.stringify(fields)
      });
      const refreshToken = data?.refresh_token || (provider === 'simkl' ? previous?.refreshToken : null);
      if (!opaque(data?.access_token) || !opaque(refreshToken) || typeof data?.token_type !== 'string' || data.token_type.toLowerCase() !== 'bearer' ||
          !Number.isFinite(data.expires_in) || data.expires_in <= 0 || data.expires_in > 366 * 86400) throw new Error(`${config.name} returned invalid account credentials. Reconnect.`);
      return { accessToken: data.access_token, refreshToken, expiresAt: Date.now() + data.expires_in * 1000 };
    },
    async connectTrackerAccount(provider, epoch) {
      const account = (await this.readTrackerAccounts())[provider];
      this.assertTrackerEpoch(provider, epoch);
      const clientId = clientIdOf(account?.clientId);
      await this.trackerPermission(provider);
      this.assertTrackerEpoch(provider, epoch);
      const callback = this.trackerCallback(provider), state = random(), verifier = random();
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
      const challenge = btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const authorize = new URL(PROVIDERS[provider].authorize);
      for (const [key, value] of Object.entries({ client_id: clientId, response_type: 'code', redirect_uri: callback,
        state, code_challenge: challenge, code_challenge_method: 'S256', ...(provider === 'simkl' ? { scope: 'media:read' } : {}) })) authorize.searchParams.set(key, value);
      this.assertTrackerEpoch(provider, epoch);
      let redirected;
      try { redirected = await chrome.identity.launchWebAuthFlow({ url: authorize.href, interactive: true }); }
      catch (_) { throw new Error(`${PROVIDERS[provider].name} connection was cancelled or denied.`); }
      this.assertTrackerEpoch(provider, epoch);
      let result;
      try { result = new URL(redirected); } catch (_) { throw new Error('The tracker returned an invalid callback.'); }
      const expected = new URL(callback);
      if (result.origin !== expected.origin || result.pathname !== expected.pathname || result.hash || result.username || result.password ||
          result.searchParams.getAll('state').length !== 1 || result.searchParams.get('state') !== state ||
          (provider === 'simkl' && (result.searchParams.getAll('iss').length !== 1 || result.searchParams.get('iss') !== 'https://simkl.com'))) throw new Error('The tracker returned an invalid callback.');
      if (result.searchParams.has('error')) throw new Error(`${PROVIDERS[provider].name} access was denied.`);
      const code = result.searchParams.get('code');
      if (!opaque(code) || result.searchParams.getAll('code').length !== 1) throw new Error('The tracker returned an invalid authorization code.');
      const tokens = await this.exchangeTrackerToken(provider, { client_id: clientId, redirect_uri: callback, code, grant_type: 'authorization_code', code_verifier: verifier });
      this.assertTrackerEpoch(provider, epoch);
      await this.commitTracker(provider, epoch, current => {
        if (current.clientId !== clientId) throw new Error('Tracker application changed. Connect again.');
        return { clientId, ...tokens, accountRevision: random() };
      });
    },
    async currentTrackerToken(provider, epoch) {
      let account = (await this.readTrackerAccounts())[provider];
      this.assertTrackerEpoch(provider, epoch);
      if (!opaque(account?.accessToken) || !opaque(account?.refreshToken)) throw new Error(`Connect ${PROVIDERS[provider].name} in Settings first.`);
      if (Number.isFinite(account.expiresAt) && account.expiresAt > Date.now() + 60000) return account;
      this.trackerRefreshes ??= new Map();
      const existing = this.trackerRefreshes.get(provider);
      if (existing?.epoch === epoch) return existing.promise;
      const snapshot = account;
      const promise = (async () => {
        const fields = { client_id: snapshot.clientId, refresh_token: snapshot.refreshToken, grant_type: 'refresh_token',
          ...(provider === 'trakt' ? { redirect_uri: this.trackerCallback(provider) } : {}) };
        const tokens = await this.exchangeTrackerToken(provider, fields, snapshot);
        await this.assertTrackerSnapshot(provider, epoch, snapshot);
        account = await this.commitTracker(provider, epoch, current => {
          if (current.accessToken !== snapshot.accessToken || current.refreshToken !== snapshot.refreshToken) throw new Error('Tracker account changed. Try again.');
          return { ...current, ...tokens };
        });
        return account;
      })();
      const job = { epoch, promise }; this.trackerRefreshes.set(provider, job);
      try { return await promise; } finally { if (this.trackerRefreshes.get(provider) === job) this.trackerRefreshes.delete(provider); }
    },
    trackerApiUrl(provider, pathname) {
      const url = new URL(pathname, PROVIDERS[provider].origin);
      if (provider === 'simkl') {
        url.searchParams.set('app-name', 'Super Seerr');
        url.searchParams.set('app-version', chrome.runtime.getManifest().version);
      }
      return url;
    },
    async trackerApiRead(provider, pathname, account) {
      const url = this.trackerApiUrl(provider, pathname);
      const headers = { Authorization: `Bearer ${account.accessToken}`, 'Content-Type': 'application/json' };
      if (provider === 'trakt') { headers['trakt-api-key'] = account.clientId; headers['trakt-api-version'] = '2'; }
      else url.searchParams.set('client_id', account.clientId);
      return this.trackerFetch(provider, url.href, { method: 'GET', headers });
    },
    async readTrackerWatchlist(provider, page, snapshotId = null) {
      const epoch = this.trackerEpoch(provider);
      const localPage = provider === 'simkl' && page > 1;
      let account;
      if (localPage) {
        account = (await this.readTrackerAccounts())[provider];
        this.assertTrackerEpoch(provider, epoch);
        if (!opaque(account?.accessToken) || !opaque(account?.refreshToken)) throw new Error('Connect Simkl in Settings first.');
      } else {
        await this.trackerPermission(provider);
        account = await this.currentTrackerToken(provider, epoch);
      }
      let rows, nextPage = null, skipped = 0, truncated = false, reviewId = null;
      if (provider === 'trakt') {
        // The combined watchlist uses singular `movie,show` in Trakt's own
        // contract; `/movies` and `/shows` are the separate list resources.
        const response = await this.trackerApiRead(provider, `/users/me/watchlist/movie,show/added?page=${page}&limit=${PAGE_SIZE}`, account);
        if (!Array.isArray(response.data)) throw new Error('Trakt returned an invalid watchlist.');
        if (response.data.length > PAGE_SIZE) throw new Error('Trakt returned too many items for one page.');
        rows = response.data.map(row => normalize(row, provider));
        skipped = rows.filter(row => !row).length;
        rows = rows.filter(Boolean);
        const pages = Number(response.headers.get('X-Pagination-Page-Count'));
        const current = Number(response.headers.get('X-Pagination-Page'));
        if (!Number.isSafeInteger(pages) || pages < 0 || current !== page) throw new Error('Trakt returned invalid pagination information.');
        nextPage = page < pages && page < 5 ? page + 1 : null;
        truncated = page === 5 && pages > 5;
      } else {
        let cached;
        if (page > 1) {
          cached = await this.findSimklSnapshot(epoch, account, { id: snapshotId });
          if (!cached) throw new Error('This Simkl review is no longer available. Choose Sync watchlist to start a new review.');
        } else {
          const activities = (await this.trackerApiRead(provider, '/sync/activities', account)).data;
          if (!activities || typeof activities !== 'object' || Array.isArray(activities)) throw new Error('Simkl returned invalid activity information.');
          await this.assertTrackerSnapshot(provider, epoch, account);
          const activity = typeof activities?.all === 'string' || activities?.all === null ? activities.all : undefined;
          if (activity === undefined) throw new Error('Simkl returned invalid activity information.');
          // A null top-level activity is a valid marker for an account with no
          // recorded activity. Keep it distinct from a deliberately truncated
          // local snapshot so an empty watchlist does not trigger a full pull
          // on every manual Sync.
          cached = await this.findSimklSnapshot(epoch, account, { activity });
          if (!cached) {
            const movies = (await this.trackerApiRead(provider, '/sync/all-items/movies/plantowatch', account)).data;
            await this.assertTrackerSnapshot(provider, epoch, account);
            const shows = (await this.trackerApiRead(provider, '/sync/all-items/shows/plantowatch', account)).data;
            await this.assertTrackerSnapshot(provider, epoch, account);
            const anime = (await this.trackerApiRead(provider, '/sync/all-items/anime/plantowatch', account)).data;
            const validList = (data, field) => data && typeof data === 'object' && !Array.isArray(data) && (data[field] == null || Array.isArray(data[field]));
            if (!validList(movies, 'movies') || !validList(shows, 'shows') || !validList(anime, 'anime')) throw new Error('Simkl returned an invalid watchlist.');
            const normalized = [...(movies.movies || []), ...(shows.shows || [])].map(row => normalize(row, provider))
              .concat((anime.anime || []).map(row => normalize(row, provider, true)));
            const valid = [...new Map(normalized.filter(Boolean).map(item => [JSON.stringify([item.mediaType, item.tmdbId || item.imdbId || item.title.toLowerCase(), item.year]), item])).values()];
            await this.assertTrackerSnapshot(provider, epoch, account);
            cached = await this.saveSimklSnapshot(epoch, account, { activity, items: valid.slice(0, MAX_ITEMS),
              skipped: normalized.length - valid.length, truncated: valid.length > MAX_ITEMS });
          }
        }
        rows = cached.items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
        nextPage = cached.items.length > page * PAGE_SIZE && page < 5 ? page + 1 : null;
        skipped = page === 1 ? cached.skipped : 0; truncated = cached.truncated;
        reviewId = cached.id;
      }
      const current = await this.assertTrackerSnapshot(provider, epoch, account, { allowTokenRotation: localPage });
      let lastSyncAt = Number.isFinite(current.lastSyncAt) ? current.lastSyncAt : null;
      if (!localPage) {
        lastSyncAt = Date.now();
        await this.commitTracker(provider, epoch, current => {
          if (current.accessToken !== account.accessToken || current.refreshToken !== account.refreshToken) throw new Error('Tracker account changed. Try again.');
          return { ...current, lastSyncAt };
        });
        await this.assertTrackerSnapshot(provider, epoch, account);
      }
      return { provider, items: rows, page, nextPage, hasMore: nextPage !== null, skipped, truncated, lastSyncAt,
        ...(reviewId ? { snapshotId: reviewId } : {}) };
    },
    async trackerOperation(action, data, sender) {
      this.requireExtensionPage(sender);
      if (action === 'getTrackerAccounts') return this.publicTrackerAccounts();
      const provider = providerOf(data?.provider);
      if (action === 'getTrackerWatchlist') {
        const page = data?.page ?? 1;
        if (!Number.isSafeInteger(page) || page < 1 || page > 5) throw new Error('Choose a watchlist page from 1 to 5');
        if (provider === 'simkl' && page > 1 && !snapshotIdOf(data?.snapshotId)) throw new Error('Choose Sync watchlist to start a new Simkl review before loading more.');
        return this.readTrackerWatchlist(provider, page, data?.snapshotId);
      }
      if (!['saveTrackerApp', 'connectTracker', 'disconnectTracker'].includes(action)) throw new Error('Unknown tracker action');
      const clientId = action === 'saveTrackerApp' ? clientIdOf(data?.clientId) : null;
      this.trackerMutationIntents ??= {};
      const intent = this.trackerMutationIntents[provider] = (this.trackerMutationIntents[provider] || 0) + 1;
      if (action === 'saveTrackerApp' || action === 'connectTracker') {
        const current = (await this.readTrackerAccounts())[provider];
        if (this.trackerMutationIntents[provider] !== intent) throw new Error('Tracker account changed. Try again.');
        if (action === 'connectTracker' && opaque(current?.accessToken) && opaque(current?.refreshToken)) throw new Error('Disconnect the current tracker account before connecting another.');
        // Re-saving the same application must not invalidate a rotating token
        // refresh and leave the consumed refresh token stranded in storage.
        if (action === 'saveTrackerApp' && current?.clientId === clientId) return this.publicTrackerAccounts();
      }
      const epoch = this.invalidateTracker(provider);
      if (action === 'saveTrackerApp') await this.commitTracker(provider, epoch, () => ({ clientId, accountRevision: random() }));
      else if (action === 'disconnectTracker') await this.commitTracker(provider, epoch, current => ({ clientId: current.clientId || '', accountRevision: random() }));
      else await this.connectTrackerAccount(provider, epoch);
      return this.publicTrackerAccounts();
    }
  };
})(globalThis);

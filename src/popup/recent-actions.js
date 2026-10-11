(function () {
  const list = document.getElementById('recentActionsList');
  const status = document.getElementById('recentActionsStatus');
  const clear = document.getElementById('clearRecentActions');
  const labels = { request: 'Requested', 'seerr-watchlist': 'Added to Seerr watchlist', 'plex-watchlist': 'Added to Plex watchlist' };
  const identity = entry => JSON.stringify([entry.at, entry.kind, entry.mediaType, entry.title, entry.tmdbId ?? null, entry.server ?? null]);
  let generation = 0;
  let clearing = false;
  let refreshFocusOwner = null;
  async function load() {
    const current = ++generation;
    // Historical actions remain valid; statuses and links belong to the
    // settings snapshot that produced them and must be checked again.
    list.querySelectorAll('.recent-action-state, a').forEach(node => node.remove());
    list.setAttribute('aria-busy', 'true');
    status.textContent = 'Loading history…';
    let historyLoaded = false;
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getRecentActions' });
      if (current !== generation) return;
      if (!response?.success || !Array.isArray(response.data)) throw new Error();
      list.replaceChildren();
      const rendered = [];
      for (const entry of response.data) {
        if (!entry || !labels[entry.kind] || !Number.isFinite(entry.at) || !Number.isFinite(new Date(entry.at).getTime())) continue;
        const item = document.createElement('li');
        const title = document.createElement('span');
        title.textContent = `${labels[entry.kind]}: ${entry.title} (${entry.mediaType === 'tv' ? 'TV' : 'Movie'})`;
        const time = document.createElement('time');
        time.dateTime = new Date(entry.at).toISOString(); time.textContent = new Date(entry.at).toLocaleString();
        item.append(title);
        // The worker supplies the sanitized historical destination, independent
        // of whichever site is active when the popup opens.
        if (entry.kind !== 'plex-watchlist' && typeof entry.server === 'string' && entry.server) {
          const server = document.createElement('span'); server.className = 'recent-action-server';
          server.textContent = `Seerr: ${entry.server.replace(/\/+$/, '')}`; item.append(server);
        }
        item.append(time); list.appendChild(item);
        rendered.push({ entry, item });
      }
      status.textContent = list.children.length ? '' : 'No confirmed actions yet.';
      clear.disabled = !list.children.length;
      historyLoaded = true;
      if (!rendered.length) return;
      const responseStatus = await chrome.runtime.sendMessage({ action: 'getRecentActionStatuses' });
      if (current !== generation) return;
      if (!responseStatus?.success || !Array.isArray(responseStatus.data)) { status.textContent = 'History loaded; current status is unavailable. Try Refresh statuses.'; return; }
      const statuses = new Map(responseStatus.data.filter(Boolean).map(entry => [identity(entry), entry]));
      for (const row of rendered) {
        const entry = statuses.get(identity(row.entry));
        if (!entry?.status) continue;
        const item = row.item;
        const state = document.createElement('span'); state.className = 'recent-action-state'; state.textContent = entry.status; item.appendChild(state);
        if (entry.url && /^https?:\/\//.test(entry.url)) {
          const link = document.createElement('a'); link.href = entry.url; link.textContent = 'Open in Seerr'; link.target = '_blank'; link.rel = 'noopener noreferrer'; item.appendChild(link);
        }
      }
    } catch (_) {
      if (current !== generation) return;
      status.textContent = historyLoaded ? 'History loaded; current status is unavailable. Try Refresh statuses.' : 'Could not load history. Try Refresh statuses.';
    } finally {
      if (current === generation) list.removeAttribute('aria-busy');
    }
  }
  clear.addEventListener('click', async () => {
    const restoreFocus = document.activeElement === clear;
    refreshFocusOwner = null;
    clearing = true;
    generation++; clear.disabled = true; refresh.disabled = true;
    list.setAttribute('aria-busy', 'true');
    try {
      const response = await chrome.runtime.sendMessage({ action: 'clearRecentActions' });
      if (!response?.success) throw new Error();
      // The deletion is confirmed even if a subsequent worker read fails.
      list.replaceChildren();
      status.textContent = 'No confirmed actions yet.';
      await load();
    } catch (_) { status.textContent = 'Could not clear history. Try again.'; clear.disabled = false; }
    finally {
      clearing = false; refresh.disabled = false;
      list.removeAttribute('aria-busy');
      if (restoreFocus && (document.activeElement === clear || document.activeElement === document.body)) {
        (clear.disabled ? refresh : clear).focus();
      }
    }
  });
  const refresh = document.createElement('button'); refresh.type = 'button'; refresh.textContent = 'Refresh statuses';
  refresh.className = 'button secondary';
  clear.className = 'button secondary';
  const actions = document.createElement('div'); actions.className = 'recent-action-controls';
  clear.before(actions); actions.append(refresh, clear);
  document.addEventListener('focusin', event => {
    if (refreshFocusOwner && event.target !== refreshFocusOwner && event.target !== document.body) refreshFocusOwner = null;
  });
  async function refreshHistory() {
    const active = document.activeElement;
    if (active === refresh || list.contains(active)) refreshFocusOwner = active;
    else if (active !== document.body) refreshFocusOwner = null;
    refresh.disabled = true;
    const pending = load();
    const current = generation;
    await pending;
    if (current === generation) {
      const owner = refreshFocusOwner;
      refreshFocusOwner = null;
      refresh.disabled = false;
      if (owner && (document.activeElement === owner || document.activeElement === document.body)) refresh.focus();
    }
  }
  refresh.addEventListener('click', refreshHistory);
  chrome.runtime.onMessage?.addListener(message => {
    if (message?.action !== 'seerrConfigChanged') return;
    // A disabled button blocks clicks while an obsolete refresh is pending.
    // Start a new generation directly; clearing already reloads after deletion.
    if (!clearing) void refreshHistory();
  });
  void load();
})();

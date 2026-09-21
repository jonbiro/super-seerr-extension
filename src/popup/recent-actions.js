(function () {
  const list = document.getElementById('recentActionsList');
  const status = document.getElementById('recentActionsStatus');
  const clear = document.getElementById('clearRecentActions');
  const labels = { request: 'Requested', 'seerr-watchlist': 'Added to Seerr watchlist', 'plex-watchlist': 'Added to Plex watchlist' };
  const identity = entry => JSON.stringify([entry.at, entry.kind, entry.mediaType, entry.title, entry.tmdbId ?? null, entry.server ?? null]);
  let generation = 0;
  async function load() {
    const current = ++generation;
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
        item.append(title, time); list.appendChild(item);
        rendered.push({ entry, item });
      }
      status.textContent = list.children.length ? '' : 'No confirmed actions yet.';
      clear.disabled = !list.children.length;
      historyLoaded = true;
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
    }
  }
  clear.addEventListener('click', async () => {
    generation++; clear.disabled = true; refresh.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({ action: 'clearRecentActions' });
      if (!response?.success) throw new Error();
      await load();
    } catch (_) { status.textContent = 'Could not clear history. Try again.'; clear.disabled = false; }
    finally { refresh.disabled = false; }
  });
  const refresh = document.createElement('button'); refresh.type = 'button'; refresh.textContent = 'Refresh statuses';
  refresh.className = 'button secondary';
  clear.className = 'button secondary';
  const actions = document.createElement('div'); actions.className = 'recent-action-controls';
  clear.before(actions); actions.append(refresh, clear);
  refresh.addEventListener('click', async () => {
    refresh.disabled = true;
    const pending = load();
    const current = generation;
    await pending;
    if (current === generation) refresh.disabled = false;
  });
  void load();
})();

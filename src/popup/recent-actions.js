(function () {
  const list = document.getElementById('recentActionsList');
  const status = document.getElementById('recentActionsStatus');
  const clear = document.getElementById('clearRecentActions');
  const labels = { request: 'Requested', 'seerr-watchlist': 'Added to Seerr watchlist', 'plex-watchlist': 'Added to Plex watchlist' };
  let generation = 0;
  async function load() {
    const current = ++generation;
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getRecentActions' });
      if (!response?.success || !Array.isArray(response.data)) throw new Error();
      list.replaceChildren();
      for (const entry of response.data) {
        if (!labels[entry.kind]) continue;
        const item = document.createElement('li');
        const title = document.createElement('span');
        title.textContent = `${labels[entry.kind]}: ${entry.title} (${entry.mediaType === 'tv' ? 'TV' : 'Movie'})`;
        const time = document.createElement('time');
        time.dateTime = new Date(entry.at).toISOString(); time.textContent = new Date(entry.at).toLocaleString();
        item.append(title, time); list.appendChild(item);
      }
      status.textContent = list.children.length ? '' : 'No confirmed actions yet.';
      clear.disabled = !list.children.length;
      const responseStatus = await chrome.runtime.sendMessage({ action: 'getRecentActionStatuses' });
      if (current !== generation) return;
      if (!responseStatus?.success || !Array.isArray(responseStatus.data)) { status.textContent = 'History loaded; current status is unavailable. Try Refresh statuses.'; return; }
      for (const [index, entry] of responseStatus.data.entries()) {
        const item = list.children[index]; if (!item || !entry.status) continue;
        const state = document.createElement('span'); state.textContent = entry.status; item.appendChild(state);
        if (entry.url && /^https?:\/\//.test(entry.url)) {
          const link = document.createElement('a'); link.href = entry.url; link.textContent = 'Open in Seerr'; link.target = '_blank'; link.rel = 'noopener noreferrer'; item.appendChild(link);
        }
      }
    } catch (_) { status.textContent = 'Could not load history. Reopen the popup to retry.'; }
  }
  clear.addEventListener('click', async () => {
    generation++; clear.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({ action: 'clearRecentActions' });
      if (!response?.success) throw new Error();
      await load();
    } catch (_) { status.textContent = 'Could not clear history. Try again.'; clear.disabled = false; }
  });
  const refresh = document.createElement('button'); refresh.type = 'button'; refresh.textContent = 'Refresh statuses';
  clear.before(refresh);
  refresh.addEventListener('click', async () => { refresh.disabled = true; await load(); refresh.disabled = false; });
  void load();
})();

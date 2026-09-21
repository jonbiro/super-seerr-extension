(function () {
  const list = document.getElementById('recentActionsList');
  const status = document.getElementById('recentActionsStatus');
  const clear = document.getElementById('clearRecentActions');
  const labels = { request: 'Requested', 'seerr-watchlist': 'Added to Seerr watchlist', 'plex-watchlist': 'Added to Plex watchlist' };
  async function load() {
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
    } catch (_) { status.textContent = 'Could not load history. Reopen the popup to retry.'; }
  }
  clear.addEventListener('click', async () => {
    clear.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({ action: 'clearRecentActions' });
      if (!response?.success) throw new Error();
      await load();
    } catch (_) { status.textContent = 'Could not clear history. Try again.'; clear.disabled = false; }
  });
  void load();
})();

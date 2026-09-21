// Explicit local management and export; reports never contain settings values.
(function () {
  const section = document.createElement('section'); section.className = 'settings-section support-tools';
  const heading = document.createElement('h2'); heading.textContent = 'Saved matches and support';
  const list = document.createElement('ul');
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const inspect = document.createElement('button'); inspect.type = 'button'; inspect.textContent = 'Inspect saved title matches';
  const search = document.createElement('input'); search.type = 'search';
  search.placeholder = 'Search title, server or TMDB ID'; search.setAttribute('aria-label', 'Search saved matches'); search.hidden = true;
  let matches = [];
  let matchRevision = 0;
  function serverLabel(entry) {
    try {
      const parts = JSON.parse(entry.key);
      const url = new URL(parts[0]);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return 'Unknown server';
      return url.host + url.pathname.replace(/\/$/, '');
    } catch (_) { return 'Unknown server'; }
  }
  function render() {
    const query = search.value.trim().toLocaleLowerCase();
    const visible = matches.filter(entry => [entry.title, entry.selectedTitle, entry.mediaType, entry.year, entry.tmdbId, serverLabel(entry)].join(' ').toLocaleLowerCase().includes(query));
    list.replaceChildren();
    for (const entry of visible) {
      const row = document.createElement('li');
      const text = document.createElement('span'); text.textContent = `${entry.title} → ${entry.selectedTitle} (${entry.year || 'unknown year'}, ${entry.mediaType}, TMDB ${entry.tmdbId})`;
      const details = document.createElement('details');
      const summary = document.createElement('summary'); summary.textContent = `Match details · ${serverLabel(entry)}`;
      const fields = document.createElement('dl');
      for (const [label, value] of [['Original title', entry.title], ['Selected title', entry.selectedTitle], ['Server', serverLabel(entry)], ['Media type', entry.mediaType], ['Year', entry.year || 'Unknown'], ['TMDB ID', entry.tmdbId]]) {
        const term = document.createElement('dt'); term.textContent = label;
        const description = document.createElement('dd'); description.textContent = String(value ?? 'Unknown');
        fields.append(term, description);
      }
      details.append(summary, fields);
      const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'button secondary'; reset.textContent = 'Forget match';
      reset.addEventListener('click', async () => {
        reset.disabled = true;
        try {
          const result = await chrome.runtime.sendMessage({ action: 'removeTitleCorrection', key: entry.key });
          if (!result?.success) throw new Error();
          matchRevision++;
          matches = matches.filter(item => item.key !== entry.key); render(); search.focus();
          status.textContent = 'Match forgotten. Reload its page to choose again.';
        } catch (_) { reset.disabled = false; status.textContent = 'Could not forget match.'; }
      });
      row.append(text, reset, details); list.appendChild(row);
    }
    status.textContent = matches.length ? `${visible.length} of ${matches.length} matches. Matches apply only to their original server and are checked again before use.` : 'No saved title matches.';
  }
  search.addEventListener('input', render);
  inspect.addEventListener('click', async () => {
    const revision = matchRevision;
    inspect.disabled = true; list.setAttribute('aria-busy', 'true');
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getTitleCorrections' });
      if (revision !== matchRevision) return;
      if (!response?.success || !Array.isArray(response.data)) throw new Error();
      matches = response.data; search.hidden = false; render();
    } catch (_) { if (revision === matchRevision) status.textContent = 'Could not load saved matches. Try again.'; }
    finally { inspect.disabled = false; list.removeAttribute('aria-busy'); }
  });
  const prepare = document.createElement('button'); prepare.type = 'button'; prepare.textContent = 'Prepare diagnostic report';
  const preview = document.createElement('textarea'); preview.readOnly = true; preview.rows = 12; preview.style.width = '100%'; preview.hidden = true; preview.setAttribute('aria-label', 'Diagnostic report preview');
  const download = document.createElement('button'); download.type = 'button'; download.textContent = 'Download report'; download.hidden = true;
  let report = '';
  prepare.addEventListener('click', async () => {
    prepare.disabled = true; download.hidden = true;
    try {
      const response = await chrome.runtime.sendMessage({ action: 'exportDiagnostics' }); if (!response?.success) throw new Error();
      report = JSON.stringify(response.data, null, 2); preview.value = report; preview.hidden = false; download.hidden = false;
      status.textContent = 'Review before sharing. This report excludes server addresses, credentials, titles, history and raw errors.';
    } catch (_) { status.textContent = 'Could not prepare diagnostics. Try again.'; }
    finally { prepare.disabled = false; }
  });
  download.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([report], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'super-seerr-diagnostics.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  for (const button of [inspect, prepare, download]) button.className = 'button secondary';
  const description = document.createElement('p'); description.textContent = 'Manage remembered title choices or prepare a private diagnostic report to review before sharing.';
  const actions = document.createElement('div'); actions.className = 'support-actions'; actions.append(inspect, prepare);
  section.append(heading, description, actions, search, list, status, preview, download); document.querySelector('main').appendChild(section);
})();

// Explicit local management and export; reports never contain settings values.
(function () {
  const section = document.createElement('section'); section.className = 'settings-section';
  const heading = document.createElement('h2'); heading.textContent = 'Saved matches and support';
  const list = document.createElement('ul');
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const inspect = document.createElement('button'); inspect.type = 'button'; inspect.textContent = 'Inspect saved title matches';
  inspect.addEventListener('click', async () => {
    const response = await chrome.runtime.sendMessage({ action: 'getTitleCorrections' }); list.replaceChildren();
    if (!response?.success) { status.textContent = 'Could not load saved matches.'; return; }
    for (const entry of response.data) {
      const row = document.createElement('li');
      const text = document.createElement('span'); text.textContent = `${entry.title} → ${entry.selectedTitle} (${entry.year || 'unknown year'}, ${entry.mediaType}, TMDB ${entry.tmdbId})`;
      const reset = document.createElement('button'); reset.type = 'button'; reset.textContent = 'Forget match';
      reset.addEventListener('click', async () => {
        reset.disabled = true;
        try { const result = await chrome.runtime.sendMessage({ action: 'removeTitleCorrection', key: entry.key }); if (!result?.success) throw new Error(); row.remove(); status.textContent = 'Match forgotten. Reload its page to choose again.'; }
        catch (_) { reset.disabled = false; status.textContent = 'Could not forget match.'; }
      });
      row.append(text, reset); list.appendChild(row);
    }
    status.textContent = response.data.length ? 'Matches apply only to their original server and are checked again before use.' : 'No saved title matches.';
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
  section.append(heading, inspect, list, prepare, status, preview, download); document.querySelector('main').appendChild(section);
})();

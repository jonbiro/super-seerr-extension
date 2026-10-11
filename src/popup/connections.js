(function () {
  const section = document.getElementById('seerrSiteSwitcher');
  const select = document.getElementById('activeSeerrSite');
  const status = document.getElementById('siteSwitchStatus');
  let connections, generation = 0, switching = false, refreshPending = false, pendingChange;
  const alreadyRendered = value => value && value.revision === connections?.revision && value.activeId === connections?.activeId;
  function render(value) {
    if (!Array.isArray(value?.sites)) throw new Error('Could not load saved sites. Reopen the popup to retry.');
    connections = value;
    select.replaceChildren();
    for (const site of connections.sites) {
      const option = document.createElement('option'); option.value = site.id;
      option.textContent = `${site.name} — ${site.url}`; select.append(option);
    }
    select.value = connections.activeId || '';
    select.title = connections.sites.find(site => site.id === connections.activeId)?.url || '';
    section.classList.toggle('hidden', !connections.sites.length);
  }
  async function load(changed = false) {
    const current = ++generation;
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getSeerrConnections' });
      if (current !== generation) return;
      if (!response?.success) throw new Error('Could not load saved sites. Reopen the popup to retry.');
      render(response.data);
      select.disabled = false;
      if (changed) status.textContent = 'Active site updated.';
    } catch (error) {
      if (current !== generation) return;
      section.classList.remove('hidden'); select.value = ''; select.title = ''; select.disabled = true;
      status.textContent = error.message;
    }
  }
  select.addEventListener('change', async () => {
    const site = connections?.sites.find(item => item.id === select.value);
    if (!site || switching) return;
    const url = new URL(site.url);
    generation++; switching = true;
    select.disabled = true; status.textContent = 'Switching sites…';
    try {
      // Host permission needs the change gesture before any asynchronous read.
      const permission = chrome.permissions.request({ origins: [`${url.protocol}//${url.hostname}/*`] });
      if (!await permission) throw new Error('Site access was declined. Your active site has not changed.');
      const response = await chrome.runtime.sendMessage({ action: 'activateSeerrConnection', data: { id: site.id } });
      if (!response?.success) throw new Error(response?.error || 'Could not switch sites');
      // The mutation already returns the committed list. A second read could
      // fail and incorrectly roll the selector back after a successful switch.
      render(response.data);
      status.textContent = 'Site switched. Reload its Seerr tab if ratings are not visible yet.';
    } catch (error) {
      select.value = connections.activeId || '';
      status.textContent = error.message;
    } finally {
      switching = false; select.disabled = false;
      const reload = refreshPending && !alreadyRendered(pendingChange);
      refreshPending = false; pendingChange = null;
      if (reload) void load(true);
    }
  });
  chrome.storage?.onChanged?.addListener((changes, namespace) => {
    if (!((namespace === 'local' && changes.seerrConnectionsV1) || (namespace === 'sync' && changes.seerrUrl))) return;
    const value = changes.seerrConnectionsV1?.newValue;
    if (alreadyRendered(value)) return;
    if (switching) { refreshPending = true; pendingChange = value; }
    else void load(true);
  });
  void load();
})();

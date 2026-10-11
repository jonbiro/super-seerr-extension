(function () {
  const section = document.getElementById('seerrSiteSwitcher');
  const select = document.getElementById('activeSeerrSite');
  const status = document.getElementById('siteSwitchStatus');
  let connections;
  async function load() {
    const response = await chrome.runtime.sendMessage({ action: 'getSeerrConnections' });
    if (!response?.success || !Array.isArray(response.data?.sites)) throw new Error('Could not load saved sites. Open Settings to retry.');
    connections = response.data;
    select.replaceChildren();
    for (const site of connections.sites) {
      const option = document.createElement('option'); option.value = site.id;
      option.textContent = `${site.name} — ${site.url}`; select.append(option);
    }
    select.value = connections.activeId || '';
    section.classList.toggle('hidden', !connections.sites.length);
  }
  select.addEventListener('change', async () => {
    const site = connections.sites.find(item => item.id === select.value);
    if (!site) return;
    const url = new URL(site.url);
    // Host permission needs the change gesture before any asynchronous read.
    select.disabled = true; status.textContent = 'Switching sites…';
    try {
      const permission = chrome.permissions.request({ origins: [`${url.protocol}//${url.hostname}/*`] });
      if (!await permission) throw new Error('Site access was declined. Your active site has not changed.');
      const response = await chrome.runtime.sendMessage({ action: 'activateSeerrConnection', data: { id: site.id } });
      if (!response?.success) throw new Error(response?.error || 'Could not switch sites');
      await load();
      status.textContent = 'Site switched. Reload its Seerr tab if ratings are not visible yet.';
      window.dispatchEvent(new Event('seerrConnectionChanged'));
    } catch (error) {
      select.value = connections.activeId || '';
      status.textContent = error.message;
    } finally { select.disabled = false; }
  });
  load().catch(error => { section.classList.remove('hidden'); select.disabled = true; status.textContent = error.message; });
})();

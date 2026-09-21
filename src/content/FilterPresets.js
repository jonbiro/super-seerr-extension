// Named sorting/filter preferences. Uses sync storage; never stores credentials.
(function (root) {
  root.installFilterPresets = function ({ bar, readCurrent, apply }) {
    const KEY = 'seerrFilterPresetsV1';
    const wrapper = document.createElement('span');
    wrapper.className = 'seerr-filter-presets';
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Saved filter presets');
    const name = document.createElement('input');
    name.type = 'text'; name.maxLength = 40; name.placeholder = 'Preset name';
    name.setAttribute('aria-label', 'Preset name');
    const save = document.createElement('button'); save.type = 'button'; save.textContent = 'Save preset';
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Delete preset'; remove.disabled = true;
    const status = document.createElement('span'); status.setAttribute('role', 'status');
    wrapper.append(select, name, save, remove, status); bar.appendChild(wrapper);
    const sorts = new Set([...bar.querySelector('.seerr-sort-select').options].map(option => option.value));
    const limits = { minCritics: 100, minAudience: 100, minTmdb: 10, minImdb: 10 };
    let presets = [];
    let busy = false;
    function setBusy(value) {
      busy = value;
      wrapper.setAttribute('aria-busy', String(value));
      select.disabled = value; name.disabled = value; save.disabled = value;
      remove.disabled = value || !select.value;
    }
    function validate(value) {
      if (!value || typeof value.name !== 'string' || !value.name.trim() || !sorts.has(value.sort)) return null;
      const filters = {};
      for (const [key, max] of Object.entries(limits)) {
        const number = Number(value.filters?.[key] ?? 0);
        if (!Number.isFinite(number)) return null;
        filters[key] = Math.max(0, Math.min(max, number));
      }
      return { name: value.name.trim().slice(0, 40), sort: value.sort, filters };
    }
    async function request(action, data) {
      const reply = await chrome.runtime.sendMessage({ action, data });
      if (!reply?.success || !Array.isArray(reply.data)) throw new Error(reply?.error || 'Could not update presets.');
      return reply.data.map(validate).filter(Boolean);
    }
    const load = () => request('getFilterPresets');
    function render(selected = '') {
      select.replaceChildren();
      const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'Saved presets'; select.appendChild(empty);
      for (const preset of presets) {
        const option = document.createElement('option'); option.value = preset.name; option.textContent = preset.name; select.appendChild(option);
      }
      select.value = selected;
      remove.disabled = busy || !select.value;
    }
    select.addEventListener('change', () => {
      if (busy) return;
      const preset = presets.find(item => item.name === select.value);
      remove.disabled = !preset;
      if (preset) { name.value = preset.name; apply(preset); status.textContent = `Applied ${preset.name}`; }
    });
    save.addEventListener('click', async () => {
      if (busy) return;
      const preset = validate({ name: name.value, ...readCurrent() });
      if (!preset) { status.textContent = 'Enter a name for this preset.'; name.focus(); return; }
      setBusy(true);
      try {
        const next = await request('saveFilterPreset', preset);
        presets = next; render(preset.name);
        status.textContent = `Saved ${preset.name}`;
      } catch (error) { status.textContent = error.message || 'Could not save preset.'; }
      finally { setBusy(false); }
    });
    remove.addEventListener('click', async () => {
      const selected = select.value; if (busy || !selected) return;
      setBusy(true);
      try {
        const next = await request('deleteFilterPreset', { name: selected });
        presets = next; render(); name.value = ''; status.textContent = `Deleted ${selected}`;
      } catch (_) { status.textContent = 'Could not delete preset.'; }
      finally { setBusy(false); }
    });
    let revision = 0;
    function changed(changes, area) {
      if (area !== 'sync' || !changes[KEY]) return;
      const current = ++revision;
      void load().then(value => {
        if (current !== revision) return;
        const selected = select.value;
        presets = value; render(selected);
      }).catch(() => { status.textContent = 'Could not refresh presets. Try again.'; });
    }
    chrome.storage.onChanged?.addListener(changed);
    const cleanup = () => {
      revision++;
      chrome.storage.onChanged?.removeListener?.(changed);
      root.removeEventListener('pagehide', cleanup);
    };
    bar.__seerrPresetCleanup = cleanup;
    root.addEventListener('pagehide', cleanup, { once: true });
    render(); setBusy(true);
    void load().then(value => { presets = value; render(); })
      .catch(() => { status.textContent = 'Could not load presets. Save retries loading before making changes.'; })
      .finally(() => setBusy(false));
  };
})(typeof window !== 'undefined' ? window : globalThis);

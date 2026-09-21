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
    async function load() {
      const stored = (await chrome.storage.sync.get([KEY]))[KEY];
      presets = Array.isArray(stored) ? stored.slice(0, 20).map(validate).filter(Boolean) : [];
    }
    function render(selected = '') {
      select.replaceChildren();
      const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'Saved presets'; select.appendChild(empty);
      for (const preset of presets) {
        const option = document.createElement('option'); option.value = preset.name; option.textContent = preset.name; select.appendChild(option);
      }
      select.value = selected;
      remove.disabled = !select.value;
    }
    select.addEventListener('change', () => {
      const preset = presets.find(item => item.name === select.value);
      remove.disabled = !preset;
      if (preset) { name.value = preset.name; apply(preset); status.textContent = `Applied ${preset.name}`; }
    });
    save.addEventListener('click', async () => {
      const preset = validate({ name: name.value, ...readCurrent() });
      if (!preset) { status.textContent = 'Enter a name for this preset.'; name.focus(); return; }
      save.disabled = true; remove.disabled = true;
      try {
        await load();
        const index = presets.findIndex(item => item.name === preset.name);
        if (index >= 0) presets[index] = preset;
        else {
          if (presets.length >= 20) throw new Error('Delete a preset before adding another (maximum 20).');
          presets.push(preset);
        }
        await chrome.storage.sync.set({ [KEY]: presets }); render(preset.name);
        status.textContent = `Saved ${preset.name}`;
      } catch (error) { status.textContent = error.message || 'Could not save preset.'; }
      finally { save.disabled = false; remove.disabled = !select.value; }
    });
    remove.addEventListener('click', async () => {
      const selected = select.value; if (!selected) return;
      remove.disabled = true; save.disabled = true;
      try {
        await load(); presets = presets.filter(item => item.name !== selected);
        await chrome.storage.sync.set({ [KEY]: presets }); render(); status.textContent = `Deleted ${selected}`;
      } catch (_) { status.textContent = 'Could not delete preset.'; }
      finally { save.disabled = false; remove.disabled = !select.value; }
    });
    void load().then(() => render()).catch(() => { status.textContent = 'Could not load presets.'; });
  };
})(typeof window !== 'undefined' ? window : globalThis);

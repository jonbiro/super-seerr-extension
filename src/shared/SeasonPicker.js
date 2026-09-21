// Shared by external-site flyouts and the Seerr bulk-review overlay.
(function (root) {
  root.chooseSeerrSeasons = function (options, { signal, confirmText = 'Request selected seasons' } = {}) {
    const el = (tag, attrs = {}) => {
      const node = document.createElement(tag);
      for (const [key, value] of Object.entries(attrs)) {
        if (key === 'textContent') node.textContent = value;
        else if (key === 'className') node.className = value;
        else node.setAttribute(key, value);
      }
      return node;
    };
    if (signal?.aborted) return Promise.resolve(null);
    return new Promise(resolve => {
      const previousFocus = document.activeElement;
      const backdrop = el('div', { className: 'seerr-season-picker' });
      backdrop.style.cssText = 'position:fixed;inset:0;background:#0009;z-index:2147483647;display:grid;place-items:center;padding:20px;color:#f9fafb;font:14px system-ui;';
      const dialog = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Choose TV seasons' });
      dialog.style.cssText = 'background:#171b25;border:1px solid #64748b;border-radius:12px;padding:20px;max-width:540px;width:100%;max-height:85vh;overflow:auto;';
      dialog.append(el('h2', { textContent: options.title }), el('p', { textContent: 'Choose seasons to request. Availability is for standard quality. Specials depend on your Seerr server settings.' }));
      const inputs = [];
      const confirm = el('button', { type: 'button', textContent: confirmText }); confirm.disabled = true;
      for (const season of options.seasons) {
        const label = el('label'); label.style.cssText = 'display:block;padding:10px 0;';
        const input = el('input', { type: 'checkbox', value: String(season.number) });
        input.disabled = !season.requestable;
        input.addEventListener('change', () => { confirm.disabled = !inputs.some(item => item.checked && !item.disabled); });
        inputs.push(input);
        label.append(input, document.createTextNode(` ${season.name} (${season.episodeCount} episodes) — ${season.availability}`));
        dialog.appendChild(label);
      }
      if (!options.seasons.some(season => season.requestable)) dialog.appendChild(el('p', { textContent: 'No seasons are currently available to request.' }));
      const finish = value => {
        signal?.removeEventListener('abort', cancel);
        backdrop.remove(); if (previousFocus?.isConnected) previousFocus.focus(); resolve(value);
      };
      const cancel = () => finish(null);
      signal?.addEventListener('abort', cancel, { once: true });
      const cancelButton = el('button', { type: 'button', textContent: 'Cancel' });
      cancelButton.addEventListener('click', cancel);
      confirm.addEventListener('click', () => {
        const selected = inputs.filter(input => input.checked && !input.disabled).map(input => Number(input.value));
        if (selected.length) finish(selected);
      });
      for (const button of [cancelButton, confirm]) button.style.cssText = 'padding:8px 12px;margin:12px 8px 0 0;';
      dialog.append(cancelButton, confirm); backdrop.appendChild(dialog); document.body.appendChild(backdrop);
      dialog.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
        if (event.key === 'Tab') {
          const controls = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled)')];
          const index = controls.indexOf(document.activeElement);
          if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1).focus(); }
          else if (!event.shiftKey && (index < 0 || index === controls.length - 1)) { event.preventDefault(); controls[0].focus(); }
        }
      });
      cancelButton.focus();
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);

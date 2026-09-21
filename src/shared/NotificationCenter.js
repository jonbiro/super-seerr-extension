// Shared notification timing and live regions, safe to load more than once.
(function (root) {
  if (root.SeerrNotifications) return;
  class Notifications {
    el(tag, attrs = {}) {
      const node = document.createElement(tag);
      for (const [key, value] of Object.entries(attrs)) {
        if (key === 'className' || key === 'textContent') node[key] = value;
        else node.setAttribute(key, value);
      }
      return node;
    }
  notificationStack() {
    let stack = document.querySelector('.seerr-notification-stack');
    if (!stack) {
      stack = this.el('div', { className: 'seerr-notification-stack' });
      document.body.appendChild(stack);
    }
    return stack;
  }

  createNotification(title, message, type = 'info', duration = type === 'error' ? 0 : 5000) {
    const closeBtn = this.el('button', { type: 'button', className: 'seerr-notification-close', 'aria-label': 'Dismiss notification', textContent: '×' });
    // Insert the empty live region first; populate it in a later task so assistive
    // technology can observe a change to an already-established region.
    const notification = this.el('div', { className: `seerr-notification ${type}`, role: type === 'error' ? 'alert' : 'status', 'aria-atomic': 'true' });
    let timer, started = 0, remaining = duration, hovered = false, dismissed = false;
    const pause = () => {
      if (timer !== undefined) {
        clearTimeout(timer); timer = undefined;
        remaining = Math.max(0, remaining - (Date.now() - started));
      }
    };
    const resume = () => {
      if (dismissed || duration <= 0 || hovered || notification.contains(document.activeElement) || timer !== undefined) return;
      started = Date.now();
      timer = setTimeout(() => this.removeNotification(notification), remaining);
    };
    notification.__seerrDismiss = () => { dismissed = true; pause(); clearTimeout(populate); };
    notification.addEventListener('mouseenter', () => { hovered = true; pause(); });
    notification.addEventListener('mouseleave', () => { hovered = false; resume(); });
    notification.addEventListener('focusin', pause);
    notification.addEventListener('focusout', event => { if (!notification.contains(event.relatedTarget)) setTimeout(resume, 0); });
    closeBtn.addEventListener('click', () => this.removeNotification(notification));
    const stack = this.notificationStack();
    while (stack.children.length >= 4) {
      const oldest = [...stack.children].find(note => !note.contains(document.activeElement) && !note.matches(':hover'));
      if (!oldest) break;
      oldest.__seerrDismiss?.(); oldest.remove();
    }
    stack.appendChild(notification);
    const populate = setTimeout(() => {
      if (dismissed || !notification.isConnected) return;
      notification.append(
        this.el('div', { className: 'seerr-notification-title', textContent: title }),
        this.el('div', { className: 'seerr-notification-message', textContent: message }), closeBtn
      );
      resume();
    }, 0);
    return notification;
  }

  removeNotification(notification) {
    notification?.__seerrDismiss?.();
    if (notification?.parentNode) {
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { notification.remove(); return; }
      notification.style.opacity = '0';
      notification.style.transform = 'translateX(100%)';
      setTimeout(() => notification.remove(), 300);
    }
  }

  }
  root.SeerrNotifications = new Notifications();
})(typeof window !== 'undefined' ? window : globalThis);

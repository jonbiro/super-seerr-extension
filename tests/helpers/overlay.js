const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Model = require('../../src/shared/RatingsModel');
const Config = require('../../src/shared/RatingsConfig');

class Element {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.className = '';
    this.style = {};
    this.isConnected = true;
    this.attributes = {};
    this.ownText = '';
  }
  set textContent(text) { this.ownText = String(text); this.children = []; }
  get textContent() { return this.ownText + this.children.map(child => typeof child === 'string' ? child : child.textContent).join(''); }
  setAttribute(name, value) { this.attributes[name] = value; }
  appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
  append(...children) { this.children.push(...children); }
  closest() { return this.parentElement; }
  querySelector(selector) {
    return this.children.find(child => typeof child !== 'string' && (
      selector.includes('ratings-row') && child.className === 'seerr-ratings-row' ||
      selector.includes('quality-summary') && child.className === 'seerr-quality-summary'
    )) || null;
  }
}

function loadOverlay({ pathname = '/movie/1', scripts = [], settings = {}, local = {}, apiConfigured = true, sendMessage = async () => ({ success: false }), fetch = async () => ({ ok: false }) } = {}) {
  const localStore = { ...local };
  let storageListener = null;
  const timers = [];
  const container = new Element();
  const title = container.appendChild(new Element('h1'));
  title.textContent = 'Example';
  const document = {
    readyState: 'loading', title: 'Seerr',
    addEventListener() {}, getElementById() { return null; },
    createElement: tag => new Element(tag),
    querySelector: selector => selector.includes('h1') ? title : null,
    querySelectorAll: selector => selector.startsWith('script') ? scripts.map(data => ({ textContent: JSON.stringify(data) })) : []
  };
  const context = vm.createContext({
    console, URL, document, fetch, AbortSignal,
    // Timers are recorded rather than run, so tests stay deterministic. Call
    // runTimers() to fire what the code under test scheduled.
    setTimeout: (fn, delay) => { timers.push({ fn, delay }); return timers.length; },
    clearTimeout(id) { if (timers[id - 1]) timers[id - 1].fn = null; },
    setInterval() {}, clearInterval() {},
    history: { pushState() {}, replaceState() {} },
    chrome: {
      storage: {
        sync: { get: async () => settings },
        local: {
          get: async keys => Object.fromEntries(
            (Array.isArray(keys) ? keys : [keys]).filter(key => localStore[key] !== undefined).map(key => [key, localStore[key]])
          ),
          set: async value => { Object.assign(localStore, value); },
          remove: async keys => { (Array.isArray(keys) ? keys : [keys]).forEach(key => delete localStore[key]); }
        },
        onChanged: { addListener(fn) { storageListener = fn; } }
      },
      // Answered here so a test's sendMessage only ever sees ratings traffic.
      runtime: { sendMessage: message => message?.action === 'getConfigState'
        ? Promise.resolve({ success: true, data: { apiConfigured, serverUrl: settings.seerrUrl ?? null } })
        : sendMessage(message) }
    },
    window: { RatingsModel: Model, RatingsConfig: Config, location: { pathname, search: '', origin: 'https://seerr.example' }, addEventListener() {} }
  });
  const source = fs.readFileSync(path.join(__dirname, '../../src/content/seerr-integration.js'), 'utf8');
  // Expose closure functions in the test VM only; execute the real production code.
  vm.runInContext(source.replace(/\}\)\(\);\s*$/, `globalThis.overlay = {
    getRatings, resolveRatings, mergeBundles, isBundleComplete, fetchSeerrSessionRatings, buildSummary, injectDetailRatings,
    extractSeerrNativeRatings, cleanupOverlay, ratingsCache, isSeerrPage, isRequestableTitle,
    applyScoreSort, applyScoreFilters,
    loadPersistedRatings, flushPersistedRatings, forgetRatings, ratingsCacheAge, ratingsCacheKey,
    setSort: order => { currentSort = order; },
    setResolver: fn => { resolveRatings = fn; }
  }; })();`), context);
  return {
    ...context.overlay, context, container, Model, localStore,
    // Simulate a write from elsewhere, e.g. Settings clearing the cache.
    changeLocal: changes => storageListener?.(changes, 'local'),
    // Fire timers scheduled at or under `maxDelay`, newest batch first drained.
    runTimers: (maxDelay = Infinity) => {
      const due = timers.filter(timer => timer.fn && timer.delay <= maxDelay);
      due.forEach(timer => { const fn = timer.fn; timer.fn = null; fn(); });
      return due.length;
    }
  };
}

module.exports = { loadOverlay, Element };

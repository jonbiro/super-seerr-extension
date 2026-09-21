// Loads the real shared content-script layer into a jsdom page.
// The site integrations are plain scripts sharing globals, so they are
// evaluated in order exactly as the manifest injects them.
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const SHARED = ['SeerrClient', 'MediaExtractor', 'SeasonPicker', 'NotificationCenter', 'UIComponents', 'BaseIntegration'];

function loadIntegration({
  url = 'https://www.imdb.com/title/tt0111161/',
  html = '<h1>Example</h1>',
  title = '',
  site = null,
  sendMessage = async () => ({ success: true, data: {} })
} = {}) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  if (title) dom.window.document.title = title;
  const { window } = dom;
  const messages = [];
  window.chrome = {
    runtime: { sendMessage: async message => { messages.push(message); return sendMessage(message); } },
    storage: { sync: { get: async () => ({}) }, local: { get: async () => ({}) }, onChanged: { addListener() {} } }
  };
  for (const file of SHARED) window.eval(fs.readFileSync(`src/shared/${file}.js`, 'utf8'));

  // Site integrations self-instantiate on load, starting timers and DOM work.
  // Strip the bootstrap call and the constructor's init() so extraction can be
  // exercised on its own; everything else is the production source.
  if (site) {
    const source = fs.readFileSync(`src/content/${site}-integration.js`, 'utf8');
    const bootstrap = source.match(/\n(initialize\w+Integration\(\);)\s*$/);
    if (!bootstrap) throw new Error(`${site}: expected a trailing initialize call to strip`);
    const withoutInit = source.replace(bootstrap[1], '').replace('this.init();', '');
    if (withoutInit.includes('this.init();')) throw new Error(`${site}: init() still runs`);

    // A class declaration is lexical and never lands on window, so name it.
    const className = source.match(/class (\w+Integration) extends BaseIntegration/);
    if (!className) throw new Error(`${site}: could not find the integration class`);
    window.eval(`${withoutInit}\nwindow.__Integration = ${className[1]};`);
  }

  // Count live timers and listeners so leaks are observable.
  const timers = new Set();
  const realSetInterval = window.setInterval;
  const realClearInterval = window.clearInterval;
  window.setInterval = (...args) => { const id = realSetInterval(...args); timers.add(id); return id; };
  window.clearInterval = id => { timers.delete(id); return realClearInterval(id); };

  return {
    dom, window, messages,
    liveTimers: () => timers.size,
    // The integration under test, constructed without its init() side effects.
    integration: () => new window.__Integration()
  };
}

module.exports = { loadIntegration };

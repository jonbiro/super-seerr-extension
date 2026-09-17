// Loads the real shared content-script layer into a jsdom page.
// The site integrations are plain scripts sharing globals, so they are
// evaluated in order exactly as the manifest injects them.
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const SHARED = ['SeerrClient', 'MediaExtractor', 'UIComponents', 'BaseIntegration'];

function loadIntegration({ url = 'https://www.imdb.com/title/tt0111161/', sendMessage = async () => ({ success: true, data: {} }) } = {}) {
  const dom = new JSDOM('<h1>Example</h1>', { url, runScripts: 'outside-only' });
  const { window } = dom;
  const messages = [];
  window.chrome = {
    runtime: { sendMessage: async message => { messages.push(message); return sendMessage(message); } },
    storage: { sync: { get: async () => ({}) }, local: { get: async () => ({}) }, onChanged: { addListener() {} } }
  };
  for (const file of SHARED) window.eval(fs.readFileSync(`src/shared/${file}.js`, 'utf8'));

  // Count live timers and listeners so leaks are observable.
  const timers = new Set();
  const realSetInterval = window.setInterval;
  const realClearInterval = window.clearInterval;
  window.setInterval = (...args) => { const id = realSetInterval(...args); timers.add(id); return id; };
  window.clearInterval = id => { timers.delete(id); return realClearInterval(id); };

  return { dom, window, messages, liveTimers: () => timers.size };
}

module.exports = { loadIntegration };

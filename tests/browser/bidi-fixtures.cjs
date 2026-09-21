// Firefox's native WebDriver BiDi supplies synthetic pages at their real origins.
// The extension itself is neither modified nor manually injected for these tests.
const { SITES } = require('./site-fixtures.cjs');
async function interceptSiteFixtures(url) {
  const socket = new WebSocket(url);
  const pending = new Map(); const errors = []; let nextId = 0;
  function command(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`BiDi timeout: ${method}`)); }, 10000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id); if (!request) return;
      pending.delete(message.id); clearTimeout(request.timer);
      if (message.type === 'error') request.reject(new Error(`${message.error}: ${message.message}`));
      else request.resolve(message.result);
    } else if (message.method === 'network.beforeRequestSent' && message.params.isBlocked) {
      const fixture = SITES.find(item => new URL(item.url).href === message.params.request.url);
      const body = fixture ? `<!doctype html><html><head><meta charset="utf-8"><title>Decoy fallback title</title></head><body>${fixture.html}</body></html>` : '';
      void command('network.provideResponse', { request: message.params.request.request,
        statusCode: fixture ? 200 : 404,
        headers: [{ name: 'Content-Type', value: { type: 'string', value: 'text/html; charset=utf-8' } }],
        body: { type: 'base64', value: Buffer.from(body, 'utf8').toString('base64') }
      }).catch(error => errors.push(error.message));
    }
  });
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  await command('session.subscribe', { events: ['network.beforeRequestSent'] });
  await command('network.addIntercept', { phases: ['beforeRequestSent'], urlPatterns: [...new Set(SITES.map(item => new URL(item.url).hostname))].map(hostname => ({ type: 'pattern', protocol: 'https', hostname })) });
  return { errors, close: () => socket.close() };
}
module.exports = { interceptSiteFixtures };

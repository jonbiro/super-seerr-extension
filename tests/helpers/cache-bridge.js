// Exercise the production worker bridge when testing content cache persistence.
const { loadWorker } = require('./worker');
function cacheBridge({ settings, local, url = 'https://seerr.example/movie/1' }) {
  const worker = loadWorker({ get: typeof settings === 'function' ? settings : async () => settings });
  worker.context.chrome.storage.local = local;
  return async request => {
    await worker.ready;
    return new Promise(resolve => worker.api.handleMessage(request, {
      id: 'test', url, tab: { id: 1 }, frameId: 0
    }, resolve));
  };
}
module.exports = { cacheBridge };

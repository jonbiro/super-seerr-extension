const { loadWorker } = require('./worker');
function presetBridge(sync) {
  const worker = loadWorker();
  worker.api.baseUrl = 'https://seerr.example';
  const sender = { id: 'test', tab: { id: 1 }, frameId: 0, url: 'https://seerr.example/' };
  return async message => {
    // The unit fixture only needs the preset module, not startup migration.
    await worker.ready;
    worker.context.chrome.storage.sync = sync;
    worker.api.baseUrl = 'https://seerr.example';
    try { return { success: true, data: await worker.api.filterPresetOperation(message.action, message.data, sender) }; }
    catch (error) { return { success: false, error: error.message }; }
  };
}
module.exports = { presetBridge };

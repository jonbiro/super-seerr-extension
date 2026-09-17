// Loads the real background worker into a VM with a scriptable chrome mock.
// Shared by the worker behaviour suites.
const fs = require('node:fs');
const vm = require('node:vm');
const Config = require('../../src/shared/RatingsConfig');

function loadWorker({
  get = async () => ({}),
  local = {},
  grantedOrigins = [],
  omitApis = [],
  fetch = async () => ({ ok: true, text: async () => '' })
} = {}) {
  const listeners = {};
  const writes = [];
  const removals = [];
  const localStore = { ...local };
  const localWrites = [];
  const localRemovals = [];
  const registrations = [];

  const readLocal = async keys => Object.fromEntries(
    (Array.isArray(keys) ? keys : [keys]).filter(key => localStore[key] !== undefined).map(key => [key, localStore[key]])
  );

  const logs = { log: [], warn: [], error: [] };
  const context = vm.createContext({
    console: {
      log: (...args) => logs.log.push(args),
      warn: (...args) => logs.warn.push(args),
      error: (...args) => logs.error.push(args)
    }, URL, fetch, AbortSignal, RatingsConfig: Config,
    setTimeout, clearTimeout,
    chrome: {
      storage: {
        sync: { get, set: async value => writes.push(value), remove: async keys => removals.push(keys) },
        local: {
          get: readLocal,
          set: async value => { Object.assign(localStore, value); localWrites.push(value); },
          remove: async keys => { (Array.isArray(keys) ? keys : [keys]).forEach(key => delete localStore[key]); localRemovals.push(keys); }
        },
        onChanged: { addListener: fn => { listeners.storage = fn; } }
      },
      action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
      permissions: {
        contains: async ({ origins }) => origins.every(origin => grantedOrigins.includes(origin)),
        onAdded: { addListener: fn => { listeners.permissionAdded = fn; } },
        onRemoved: { addListener: fn => { listeners.permissionRemoved = fn; } }
      },
      scripting: {
        getRegisteredContentScripts: async ({ ids }) => registrations.filter(script => ids.includes(script.id)),
        registerContentScripts: async scripts => { registrations.push(...scripts); },
        updateContentScripts: async scripts => {
          for (const script of scripts) registrations[registrations.findIndex(existing => existing.id === script.id)] = script;
        },
        unregisterContentScripts: async ({ ids }) => {
          for (const id of ids) registrations.splice(registrations.findIndex(script => script.id === id), 1);
        }
      },
      runtime: { onMessage: { addListener: fn => { listeners.message = fn; } }, onInstalled: { addListener: fn => { listeners.installed = fn; } } }
    }
  });
  // Simulate a browser that does not expose an API the worker reaches for.
  for (const api of omitApis) delete context.chrome[api];
  const source = fs.readFileSync('src/background/background.js', 'utf8');
  vm.runInContext(source.replace("import '../shared/RatingsConfig.js';", '') + '\nglobalThis.worker = seerrAPI; globalThis.ready = settingsReady;', context);
  return { api: context.worker, ready: context.ready, listeners, writes, removals, localStore, localWrites, localRemovals, registrations, logs };
}

module.exports = { loadWorker };

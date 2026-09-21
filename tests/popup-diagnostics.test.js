const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker } = require('./helpers/worker');
const origin = 'https://seerr.example';
const permissions = [`${origin}/*`, 'https://plex.tv/*', 'https://discover.provider.plex.tv/*', 'https://metadata.provider.plex.tv/*'];
async function worker({ grants = permissions, key = 'secret', plex = null } = {}) {
  const result = loadWorker({ get: async () => ({ seerrUrl: origin }), local: { seerrApiKey: key, plexToken: plex }, grantedOrigins: grants });
  await result.ready;
  return result;
}

test('diagnostics distinguish missing permissions, missing keys and optional Plex without network calls', async () => {
  const w = await worker({ grants: [], key: null });
  w.context.fetch = async () => { throw new Error('Must not fetch'); };
  const { checks } = await w.api.getPopupDiagnostics();
  assert.equal(checks.permission.state, 'error');
  assert.equal(checks.seerr.state, 'warning');
  assert.match(checks.apiKey.message, /No API key/);
  assert.match(checks.plex.message, /optional/);
});

test('diagnostics distinguish reachable server from rejected key without exposing secrets or remote errors', async () => {
  const w = await worker();
  w.context.fetch = async url => url.includes('/auth/me')
    ? { ok: false, status: 401, json: async () => ({ message: 'rejected secret' }) }
    : { ok: true };
  const result = await w.api.getPopupDiagnostics();
  assert.equal(result.checks.seerr.state, 'ok');
  assert.equal(result.checks.apiKey.state, 'error');
  assert.match(result.checks.apiKey.message, /rejected/);
  assert.doesNotMatch(JSON.stringify(result), /secret/);
});

test('diagnostics preserve independent Plex and Seerr failures and successes', async () => {
  const w = await worker({ plex: 'plex-secret' });
  w.context.fetch = async () => { throw new TypeError('Failed to fetch'); };
  w.api.plexTestConnection = async () => ({ connected: true });
  const first = await w.api.getPopupDiagnostics();
  assert.equal(first.checks.seerr.state, 'error');
  assert.equal(first.checks.plex.state, 'ok');
  w.context.fetch = async () => ({ ok: true, json: async () => ({ id: 1 }) });
  w.api.plexTestConnection = async () => { throw new Error('plex-secret'); };
  const second = await w.api.getPopupDiagnostics();
  assert.equal(second.checks.apiKey.state, 'ok');
  assert.equal(second.checks.plex.state, 'error');
  assert.doesNotMatch(JSON.stringify(second), /plex-secret/);
});

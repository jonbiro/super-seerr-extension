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

for (const field of ['baseUrl', 'apiKey', 'plexToken', 'settingsLoadGeneration']) {
  test(`diagnostics discard a report when ${field} changes during a check`, async () => {
    const w = await worker();
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const requests = [];
    w.context.fetch = async url => { requests.push(url); await pending; return { ok: true }; };
    const report = w.api.getPopupDiagnostics();
    await new Promise(resolve => setImmediate(resolve));
    w.api[field] = field === 'settingsLoadGeneration' ? w.api[field] + 1 : 'changed';
    release();
    await assert.rejects(report, /Settings changed during diagnostics/);
    assert.equal(requests.length, 1, 'obsolete checks must not start authentication');
    assert.equal(requests[0], `${origin}/api/v1/settings/public`);
  });
}

test('a change during authentication discards the completed report', async () => {
  const w = await worker();
  w.context.fetch = async (url, options) => {
    if (url.includes('/auth/me')) {
      assert.equal(options.headers['X-Api-Key'], 'secret');
      w.api.apiKey = 'replacement';
    }
    return { ok: true, json: async () => ({ id: 1 }) };
  };
  await assert.rejects(w.api.getPopupDiagnostics(), /Settings changed during diagnostics/);
});

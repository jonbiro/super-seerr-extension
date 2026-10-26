const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker } = require('./helpers/worker');

for (const [label, name, message] of [
  ['Chromium fetch failure', 'TypeError', 'Failed to fetch'],
  ['Firefox fetch failure', 'TypeError', 'NetworkError when attempting to fetch resource.'],
  ['explicit network error', 'NetworkError', 'Network request failed']
]) test(`normalizes ${label} into a reconnectable Seerr error`, async () => {
  const worker = loadWorker();
  await worker.ready;
  worker.api.baseUrl = 'https://seerr.example';
  worker.api.apiKey = 'key';
  worker.context.fetch = async () => {
    const error = new Error(message);
    error.name = name;
    throw error;
  };
  await assert.rejects(worker.api.sendAPIRequest('GET', '/api/v1/auth/me'), /Could not connect to Seerr server/);
});

test('does not rewrite unrelated TypeErrors from the Seerr transport', async () => {
  const worker = loadWorker();
  await worker.ready;
  worker.api.baseUrl = 'https://seerr.example';
  worker.api.apiKey = 'key';
  worker.context.fetch = async () => { throw new TypeError('Unexpected test failure'); };
  await assert.rejects(worker.api.sendAPIRequest('GET', '/api/v1/auth/me'), error =>
    error.name === 'TypeError' && error.message === 'Unexpected test failure');
});

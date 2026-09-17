// Verbose worker tracing logged media payloads on every request. It is now
// opt-in, so a normal install leaves the console clean.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loadWorker } = require('./helpers/worker');

test('a default install logs nothing while resolving ratings', async () => {
  const worker = loadWorker({ get: async () => ({ seerrUrl: 'https://seerr.example' }) });
  await worker.ready;
  worker.api.fetchRtHtml = async () => '';
  worker.api.parseRtSearchResults = () => [{ href: '/m/x', title: 'Example', year: 2020, rtCriticsScore: 80 }];
  worker.api.parseRtScorecard = () => ({ rtAudienceScore: 90 });
  await worker.api.getRottenTomatoesRatings({ title: 'Example', year: 2020 });

  assert.deepEqual(worker.logs.log, [], 'no console.log on the happy path');
  assert.deepEqual(worker.logs.warn, [], 'no console.warn on the happy path');
});

test('title search terms are not logged unless debug logging is enabled', async () => {
  const worker = loadWorker({ get: async () => ({ seerrUrl: 'https://seerr.example' }) });
  await worker.ready;
  worker.api.generateSearchTerms('A Very Distinctive Title');
  assert.equal(worker.logs.log.length, 0);

  worker.api.debugLogging = true;
  worker.api.generateSearchTerms('A Very Distinctive Title');
  assert.ok(worker.logs.log.length > 0, 'opting in should restore the trace');
});

test('the debugLogging flag is read from local storage at load', async () => {
  const worker = loadWorker({ get: async () => ({ seerrUrl: 'https://seerr.example' }), local: { debugLogging: true } });
  await worker.ready;
  assert.equal(worker.api.debugLogging, true);

  const quiet = loadWorker({ get: async () => ({ seerrUrl: 'https://seerr.example' }) });
  await quiet.ready;
  assert.equal(quiet.api.debugLogging, false);
});

test('errors are never gated behind the debug flag', () => {
  const worker = loadWorker();
  const source = fs.readFileSync('src/background/background.js', 'utf8');
  assert.ok(source.includes('console.error('), 'real failures must still surface');
  assert.equal(worker.api.debugLogging, false);

  // Outside the two gated helpers, every console call left in the worker
  // should be an error — a stray console.log would be unconditional again.
  const gated = /if \(this\.debugLogging\) console\.(log|warn)\(/g;
  assert.equal([...source.matchAll(gated)].length, 2, 'expected exactly the log and warn helpers');
  const bare = [...source.replace(gated, '').matchAll(/(?<!\w)console\.(\w+)\(/g)].map(match => match[1]);
  assert.deepEqual([...new Set(bare)].sort(), ['error']);
});

test('the verbose logging flag is reachable from the options page', () => {
  // A flag only settable by hand-editing storage is not a usable control.
  const html = fs.readFileSync('src/options/options.html', 'utf8');
  const script = fs.readFileSync('src/options/options.js', 'utf8');
  assert.ok(html.includes('id="debugLogging"'), 'Settings should expose the toggle');
  assert.ok(/chrome\.storage\.local\.set\([^)]*debugLogging/.test(script), 'saving should persist it');
  assert.ok(/chrome\.storage\.local\.get\(\[[^\]]*debugLogging/.test(script), 'loading should restore it');
});

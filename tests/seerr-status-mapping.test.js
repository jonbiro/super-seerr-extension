// Seerr has two different status enums. MediaRequestStatus is
// PENDING/APPROVED/DECLINED/FAILED/COMPLETED = 1..5, while MediaStatus is
// UNKNOWN/PENDING/PROCESSING/PARTIALLY_AVAILABLE/AVAILABLE/BLOCKLISTED/DELETED
// = 1..7. Feeding a request status through the media mapping made a declined
// request read as "downloading" and a failed one as "partially available".
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker } = require('./helpers/worker');

const api = () => loadWorker().api;

// A matching request, as searchRequests returns it.
const asRequest = status => ({ id: 7, type: 'movie', status, media: { tmdbId: 550, status: 5 } });
// Media info with no request attached.
const asMedia = status => ({ id: 550, mediaInfo: { status } });

test('a declined request is reported as declined, not as downloading', () => {
  const result = api().formatMediaStatus(asRequest(3), 'movie');
  assert.match(result.message, /declin/i, `declined request reported as "${result.message}"`);
  assert.notEqual(result.status, 'downloading');
});

test('a failed request is reported as failed, not as partially available', () => {
  const result = api().formatMediaStatus(asRequest(4), 'movie');
  assert.match(result.message, /fail/i, `failed request reported as "${result.message}"`);
  assert.notEqual(result.status, 'partial');
});

test('a pending request is reported as pending rather than unclear', () => {
  const result = api().formatMediaStatus(asRequest(1), 'movie');
  assert.equal(result.status, 'pending');
  assert.doesNotMatch(result.message, /unclear/i);
});

test('an approved request is still pending until it arrives', () => {
  const result = api().formatMediaStatus(asRequest(2), 'movie');
  assert.equal(result.status, 'pending');
});

test('a completed request is available to watch', () => {
  const result = api().formatMediaStatus(asRequest(5), 'movie');
  assert.equal(result.status, 'available_watch');
});

test('media statuses keep their existing meanings', () => {
  const expected = {
    1: 'available',        // UNKNOWN — nothing known, so offer the request
    2: 'pending',
    3: 'downloading',
    4: 'partial',
    5: 'available_watch'
  };
  for (const [status, expectedStatus] of Object.entries(expected)) {
    assert.equal(api().formatMediaStatus(asMedia(Number(status)), 'movie').status, expectedStatus, `media status ${status}`);
  }
});

test('a blocklisted title is not offered as requestable', () => {
  // BLOCKLISTED = 6, added by Seerr; it previously fell through to "available".
  const result = api().formatMediaStatus(asMedia(6), 'movie');
  assert.notEqual(result.status, 'available', 'requesting a blocklisted title cannot succeed');
  assert.match(result.message, /blocklist/i);
});

test('a deleted title is requestable again', () => {
  // DELETED = 7 means it left the library, so requesting it is the right offer.
  const result = api().formatMediaStatus(asMedia(7), 'movie');
  assert.equal(result.status, 'available');
  assert.equal(result.buttonClass, 'request');
});

test('every reported state maps to a button class the UI styles', () => {
  const fs = require('node:fs');
  const ui = fs.readFileSync('src/shared/UIComponents.js', 'utf8');
  const known = new Set(['request', 'available', 'downloading', 'pending', 'watch', 'error', 'partial']);
  const shapes = [...[1, 2, 3, 4, 5].map(asRequest), ...[1, 2, 3, 4, 5, 6, 7].map(asMedia)];
  for (const shape of shapes) {
    const { buttonClass } = api().formatMediaStatus(shape, 'movie');
    assert.ok(known.has(buttonClass), `unstyled button class ${buttonClass}`);
    if (buttonClass !== 'request' && buttonClass !== 'partial') {
      assert.ok(ui.includes(`seerr-request-button.${buttonClass}`), `${buttonClass} should have styling`);
    }
  }
});

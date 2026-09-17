// Year extraction previously used a hardcoded /1[8-9]\d{2}|20[0-2]\d/ range,
// so it would have silently stopped recognising release years after 2029.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isPlausibleReleaseYear, findReleaseYear } = require('../src/shared/MediaExtractor');

const thisYear = new Date().getFullYear();

test('the plausible range tracks the clock rather than a hardcoded ceiling', () => {
  assert.equal(isPlausibleReleaseYear(thisYear), true);
  assert.equal(isPlausibleReleaseYear(thisYear + 5), true, 'announced productions are plausible');
  assert.equal(isPlausibleReleaseYear(thisYear + 11), false, 'but not arbitrarily far ahead');
  assert.equal(isPlausibleReleaseYear(1895), true, 'early cinema is plausible');
  assert.equal(isPlausibleReleaseYear(1869), false);
});

test('years past the old 2029 ceiling are now recognised', () => {
  // The regression this guards: every one of these returned null before.
  for (const year of [2030, 2031, 2040]) {
    if (year > thisYear + 10) continue;
    assert.equal(findReleaseYear(`Released ${year}`), year);
  }
  // 2030 is the specific cliff the old pattern hit.
  assert.equal(isPlausibleReleaseYear(2030), thisYear + 10 >= 2030);
});

test('four-digit numbers that are not years are rejected', () => {
  // The metadata path used a bare /(\d{4})/ and would have taken these.
  assert.equal(findReleaseYear('2160p HDR'), null);
  assert.equal(findReleaseYear('9999 votes'), null);
  assert.equal(findReleaseYear('1080p'), null);
  assert.equal(findReleaseYear(''), null);
  assert.equal(findReleaseYear(null), null);
  assert.equal(findReleaseYear(undefined), null);
});

test('the first plausible year wins even when noise comes first', () => {
  assert.equal(findReleaseYear('2160p · 1999 · 8.4'), 1999);
  assert.equal(findReleaseYear('12345 1994'), 1994, 'a 5-digit run is not a year');
});

test('a year embedded in a longer digit run is not matched', () => {
  assert.equal(findReleaseYear('119944'), null);
  assert.equal(findReleaseYear('tt1999999'), null);
});

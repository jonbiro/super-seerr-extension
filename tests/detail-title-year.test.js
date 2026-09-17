// A Seerr detail heading reads "Moana 2 (2024)". Passing that whole string as
// the title makes an exact match look like a substring one, and the year was
// being discarded even though it is right there in the heading.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadOverlay } = require('./helpers/overlay');

const settings = { seerrUrl: 'https://seerr.example' };
const split = (overlay, heading) => overlay.splitDisplayTitle(heading);

test('a trailing year is taken out of the title and used as the year', () => {
  const overlay = loadOverlay({ settings });
  assert.deepEqual({ ...split(overlay, 'Moana 2 (2024)') }, { title: 'Moana 2', year: 2024 });
  assert.deepEqual({ ...split(overlay, 'Parasite (2019)') }, { title: 'Parasite', year: 2019 });
});

test('a heading without a year is left alone', () => {
  const overlay = loadOverlay({ settings });
  assert.deepEqual({ ...split(overlay, 'Moana 2') }, { title: 'Moana 2', year: null });
  assert.deepEqual({ ...split(overlay, '') }, { title: '', year: null });
});

test('a number that is part of the title is not mistaken for a year', () => {
  const overlay = loadOverlay({ settings });
  // Only a parenthesised trailing year counts.
  assert.deepEqual({ ...split(overlay, 'Blade Runner 2049') }, { title: 'Blade Runner 2049', year: null });
  assert.deepEqual({ ...split(overlay, '2012') }, { title: '2012', year: null });
  assert.deepEqual({ ...split(overlay, 'Apollo 13') }, { title: 'Apollo 13', year: null });
});

test('an implausible year in brackets stays part of the title', () => {
  const overlay = loadOverlay({ settings });
  assert.deepEqual({ ...split(overlay, 'Room (1408)') }, { title: 'Room (1408)', year: null });
});

test('the detail page looks the title up without its year attached', async () => {
  const asked = [];
  const overlay = loadOverlay({
    pathname: '/movie/1241982',
    settings,
    sendMessage: async message => {
      if (message.action === 'getRottenTomatoesRatings') asked.push(message.data);
      return { success: true, data: { rtCriticsScore: 61, confidence: 1 } };
    }
  });
  overlay.context.document.querySelector = selector =>
    selector.includes('h1') ? { textContent: 'Moana 2 (2024)', closest: () => null, parentElement: null } : null;

  await overlay.resolveRatings('1241982', 'Moana 2 (2024)', null, 'movie');

  assert.ok(asked.length > 0, 'a lookup should have been made');
  assert.equal(asked[0].title, 'Moana 2', 'the year must not be part of the title');
  assert.equal(asked[0].year, 2024, 'and must be used as the year');
});

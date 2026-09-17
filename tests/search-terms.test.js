// generateSearchTerms drives the fallback path when no TMDB id is known: each
// term becomes a sequential Seerr API call and a chance to fuzzy-match wrongly.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker } = require('./helpers/worker');

// Spread into a host array: the worker runs in a VM realm.
const terms = title => [...loadWorker().api.generateSearchTerms(title)];

test('digits inside a number are left alone', () => {
  // "Blade Runner 2049" previously yielded "Blade Runner Two0Four9".
  for (const title of ['Blade Runner 2049', '2012', '1917', 'Apollo 13']) {
    for (const term of terms(title)) {
      assert.ok(!/Two|Three|Four/.test(term), `${title} produced a mangled term: ${term}`);
    }
  }
});

test('a standalone numeral still gets its word form, and back', () => {
  assert.ok(terms('Toy Story 2').includes('Toy Story Two'));
  assert.ok(terms('The Two Towers').includes('The 2 Towers'));
  assert.ok(terms('Se7en').includes('Seven'));
  assert.ok(terms('Seven').includes('Se7en'));
});

test('year-titles collapse to a single term instead of a pile of junk', () => {
  assert.deepEqual(terms('2012'), ['2012']);
  assert.deepEqual(terms('Blade Runner 2049'), ['Blade Runner 2049']);
});

test('the original title is always first and terms are unique', () => {
  for (const title of ['Fight Club', 'Toy Story 2', 'The Two Towers', 'Se7en: Part 3']) {
    const result = terms(title);
    assert.equal(result[0], title, 'the exact title must be tried first');
    assert.equal(new Set(result).size, result.length, `duplicate terms for ${title}`);
    assert.ok(result.every(term => typeof term === 'string' && term.length > 0));
  }
});

test('subtitle and article variants are still produced', () => {
  const result = terms('The Lord of the Rings: The Two Towers');
  assert.ok(result.includes('The Lord of the Rings'), 'colon split');
  assert.ok(result.some(term => term.startsWith('Lord of the Rings')), 'leading article dropped');
});

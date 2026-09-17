// Rotten Tomatoes is matched by title, so whatever normalisation does to a
// title decides whether a score can be found at all. Stripping everything
// outside a-z turned an accent into a space, splitting the word, and reduced a
// title in a non-Latin script to nothing.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker } = require('./helpers/worker');

const normalise = title => loadWorker().api.normalizeTitleForMatch(title);

test('an accent does not split the word it sits in', () => {
  assert.equal(normalise('Amélie'), 'amelie');
  assert.equal(normalise('Léon'), 'leon');
  assert.equal(normalise('Das Boot'), 'das boot');
});

test('a title in Polish survives, which Filmweb depends on', () => {
  // Filmweb.pl is one of the seven supported sites.
  assert.equal(normalise('Podziemny krąg'), 'podziemny krag');
  assert.equal(normalise('Zimna wojna'), 'zimna wojna');
});

test('Latin letters that do not decompose are mapped by hand', () => {
  // These carry no combining mark to strip, so NFD alone leaves them.
  assert.equal(normalise('Wałęsa'), 'walesa');
  assert.equal(normalise('Ødegård'), 'odegard');
  assert.equal(normalise('Straße'), 'strasse');
  assert.equal(normalise('Æon Flux'), 'aeon flux');
});

test('a title in a non-Latin script is kept, not erased', () => {
  // It previously became an empty string, which scores zero against anything,
  // so such a title could never be matched at all.
  for (const title of ['愛のぬくもり', 'Олдбой', '기생충']) {
    assert.notEqual(normalise(title), '', `${title} was erased`);
  }
});

test('the same non-Latin title matches itself', () => {
  const worker = loadWorker();
  const score = worker.api.scoreRtSearchResult(
    { title: '愛のぬくもり', year: 2024 }, { title: '愛のぬくもり', year: 2024 });
  assert.equal(score, 1, 'identical titles should be a certain match');
});

test('a different non-Latin title does not match', () => {
  const worker = loadWorker();
  const score = worker.api.scoreRtSearchResult(
    { title: '愛のぬくもり', year: 2024 }, { title: '기생충', year: 2019 });
  assert.ok(score < 0.7, `unrelated titles scored ${score}`);
});

test('existing behaviour is unchanged', () => {
  assert.equal(normalise('The Matrix'), 'matrix', 'leading articles still dropped');
  assert.equal(normalise('Coyote vs. Acme'), 'coyote vs acme');
  assert.equal(normalise('Crouching Tiger, Hidden Dragon'), 'crouching tiger hidden dragon');
  assert.equal(normalise('Fish &amp; Chips'), 'fish chips');
  assert.equal(normalise('WALL·E'), 'wall e');
  assert.equal(normalise(''), '');
  assert.equal(normalise(undefined), '');
});

test('an accented title now matches its unaccented spelling', () => {
  // Rotten Tomatoes lists many titles without their diacritics, which is the
  // case this fix exists for.
  const worker = loadWorker();
  assert.equal(worker.api.scoreRtSearchResult(
    { title: 'Amélie', year: 2001 }, { title: 'Amelie', year: 2001 }), 1);
});

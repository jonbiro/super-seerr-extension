const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadWorker } = require('./helpers/worker');
const { loadIntegration } = require('./helpers/integration');

test('candidate lookup returns bounded safe identities and preserves title/type/year matching', async () => {
  const worker = loadWorker(); await worker.ready;
  const results = [
    { id: 1, title: 'The Thing', mediaType: 'movie', releaseDate: '1982-06-25', overview: 'A story', token: 'never-return' },
    { id: 2, title: 'The Thing', mediaType: 'movie', releaseDate: '2011-10-14' },
    { id: 3, name: 'The Thing', mediaType: 'tv', firstAirDate: '1982-01-01' },
    { id: 4, title: 'The Thing Returns', mediaType: 'movie', releaseDate: '1982-01-01' }
  ];
  worker.api.searchMedia = async () => results;
  const candidates = await worker.api.getMediaCandidates({ title: 'The Thing', mediaType: 'movie' });
  assert.equal(candidates.length, 2);
  assert.deepEqual(Array.from(candidates, candidate => candidate.year), [1982, 2011]);
  assert.doesNotMatch(JSON.stringify(candidates), /never-return/);
  assert.equal(await worker.api.resolveMediaMatch({ title: 'The Thing', mediaType: 'movie' }), null);
  const dated = await worker.api.getMediaCandidates({ title: 'The Thing', mediaType: 'movie', year: 1982 });
  assert.equal(dated.length, 1); assert.equal(dated[0].tmdbId, 1);
  await assert.rejects(worker.api.getMediaCandidates({ title: 'The Thing', mediaType: 'person' }), /Media type/);
});

test('title picker escapes remote text, traps keyboard focus and cancels without a selection', async t => {
  const page = loadIntegration(); t.after(() => page.window.close());
  const ui = new page.window.UIComponents();
  const opener = page.window.document.createElement('button'); page.window.document.body.appendChild(opener); opener.focus();
  const pending = ui.chooseTitle([{ title: '<img src=x onerror=alert(1)>', year: 1982, tmdbId: 1, mediaType: 'movie', overview: '<script>bad()</script>' }], { title: 'Film' });
  const dialog = page.window.document.querySelector('[role="dialog"]');
  assert.equal(dialog.querySelectorAll('img,script').length, 0);
  assert.equal(page.window.document.activeElement.textContent, 'Cancel');
  dialog.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  assert.equal(page.window.document.activeElement.className, 'seerr-title-choice');
  dialog.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(await pending, null);
  assert.equal(page.window.document.activeElement, opener);
});

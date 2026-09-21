const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadIntegration } = require('./helpers/integration');
for (const [site, url, title, html] of [
  ['filmweb','https://www.filmweb.pl/film/example-2019-123','1917','<h1 class="filmTitle__title">1917</h1>'],
  ['filmweb','https://www.filmweb.pl/film/example-2017-123','Blade Runner 2049','<h1 class="filmTitle__title">Blade Runner 2049</h1>'],
  ['filmweb','https://www.filmweb.pl/film/example-2017-123','Blade Runner 2049','<div class="filmTitle__originalTitle">Blade Runner 2049 (2017)</div>'],
  ['tmdb','https://www.themoviedb.org/movie/550','Example – Part Two','<h2 class="title">Example – Part Two (2024)</h2>']
]) {
  test(`${site} preserves ${title} in the extracted identity`, async t => {
    const f = loadIntegration({site,url,html});
    t.after(() => f.dom.window.close());
    assert.equal((await f.integration().extractMediaData())?.title, title);
  });
}

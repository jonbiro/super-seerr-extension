const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadIntegration } = require('./helpers/integration');
for (const path of ['/title/tt0137523/reviews/', '/title/tt0137523/fullcredits/', '/title/tt0137523/episodes/', '/title/tt0137523junk/', '/list/title/tt0137523/']) {
  test(`IMDb rejects non-detail route ${path}`, async t => {
    const f = loadIntegration({site:'imdb', url:`https://www.imdb.com${path}`, title:'User reviews - IMDb', html:'<h1>User reviews</h1>'});
    t.after(() => f.dom.window.close());
    assert.equal(await f.integration().extractMediaData(), null);
  });
}
for (const path of ['/title/tt0137523', '/title/tt0137523/?ref_=test']) {
  test(`IMDb retains title fallback on detail route ${path}`, async t => {
    const f = loadIntegration({site:'imdb', url:`https://www.imdb.com${path}`, title:'Fight Club (1999) - IMDb', html:''});
    t.after(() => f.dom.window.close());
    assert.equal((await f.integration().extractMediaData()).title, 'Fight Club');
  });
}

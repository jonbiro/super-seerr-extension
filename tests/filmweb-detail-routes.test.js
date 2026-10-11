const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadIntegration } = require('./helpers/integration');
for (const path of ['/news/example', '/person/example-123', '/film/Fight+Club-1999-837/discussion', '/serial/Breaking+Bad-2008-430668/episodes', '/user/example/film/example']) {
  test(`Filmweb rejects non-title route ${path}`, async t => {
    const f = loadIntegration({site:'filmweb', url:`https://www.filmweb.pl${path}`, title:'Discussion - Filmweb', html:'<h1>Discussion</h1>'});
    t.after(() => f.dom.window.close());
    assert.equal(await f.integration().extractMediaData(), null);
  });
}
for (const [path, type] of [['/film/Podziemny+kr%C4%85g-1999-837/','movie'], ['/serial/Breaking+Bad-2008-430668?ref=test','tv']]) {
  test(`Filmweb retains ${type} detail routes`, async t => {
    const f = loadIntegration({site:'filmweb', url:`https://www.filmweb.pl${path}`, html:'<h1 itemprop="name">Example</h1>'});
    t.after(() => f.dom.window.close());
    assert.equal((await f.integration().extractMediaData()).mediaType, type);
  });
}

for (const [type, path, title, year] of [
  ['movie', '/film/Podziemny+kr%C4%85g-1999-837', 'Fight Club', 1999],
  ['tv', '/serial/Breaking+Bad-2008-430668', 'Breaking Bad', 2008]
]) {
  test(`Filmweb ${type} original title excludes the nested release year`, async t => {
    const titleClass = type === 'tv' ? 'serialCoverSection__originalTitle' : 'filmCoverSection__originalTitle';
    const yearClass = type === 'tv' ? 'serialCoverSection__year' : 'filmCoverSection__year';
    const html = `<h1 itemprop="name">Localized title</h1><h2 class="${titleClass}">${title}<div class="${yearClass}">${year}</div></h2>`;
    const f = loadIntegration({site:'filmweb', url:`https://www.filmweb.pl${path}`, html});
    t.after(() => f.dom.window.close());
    const result = await f.integration().extractMediaData();
    assert.equal(result.title, title);
    assert.equal(result.year, year);
  });
}

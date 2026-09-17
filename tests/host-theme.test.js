// The flyout is injected into someone else's page. IMDb, Letterboxd, Trakt and
// Metacritic are dark whatever the visitor's OS is set to, so choosing a theme
// from prefers-color-scheme gives a white card on a dark site.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

function page({ bodyBackground = '', htmlBackground = '', prefersDark = false } = {}) {
  const dom = new JSDOM('<body></body>', { url: 'https://www.imdb.com/title/tt0111161/', runScripts: 'outside-only' });
  const { window } = dom;
  if (bodyBackground) window.document.body.style.background = bodyBackground;
  if (htmlBackground) window.document.documentElement.style.background = htmlBackground;
  window.matchMedia = query => ({ matches: prefersDark && query.includes('dark'), media: query });
  window.eval(fs.readFileSync('src/shared/UIComponents.js', 'utf8'));
  window.eval('window.__ui = new UIComponents({ siteName: "IMDB", theme: "flyout" });');
  return { dom, window, ui: window.__ui };
}

const themeOf = ctx => ctx.ui.createFlyout().flyout.classList.contains('seerr-theme-dark') ? 'dark' : 'light';

test('a dark host page gets the dark flyout, whatever the OS prefers', t => {
  const ctx = page({ bodyBackground: 'rgb(18, 18, 18)', prefersDark: false });
  t.after(() => ctx.dom.window.close());
  assert.equal(themeOf(ctx), 'dark', 'IMDb is dark even for a visitor whose OS is light');
});

test('a light host page gets the light flyout, whatever the OS prefers', t => {
  const ctx = page({ bodyBackground: 'rgb(255, 255, 255)', prefersDark: true });
  t.after(() => ctx.dom.window.close());
  assert.equal(themeOf(ctx), 'light');
});

test('a transparent body falls through to the document background', t => {
  const ctx = page({ bodyBackground: 'rgba(0, 0, 0, 0)', htmlBackground: 'rgb(20, 22, 28)' });
  t.after(() => ctx.dom.window.close());
  assert.equal(themeOf(ctx), 'dark');
});

test('when the page will not say, the OS preference decides', t => {
  const dark = page({ prefersDark: true });
  t.after(() => dark.dom.window.close());
  assert.equal(themeOf(dark), 'dark');

  const light = page({ prefersDark: false });
  t.after(() => light.dom.window.close());
  assert.equal(themeOf(light), 'light');
});

test('both themes are styled explicitly, not left to a media query', () => {
  const source = fs.readFileSync('src/shared/UIComponents.js', 'utf8');
  assert.match(source, /\.seerr-theme-dark[^{]*\.seerr-panel/, 'the dark panel is class-driven');
  assert.ok(!/@media \(prefers-color-scheme: dark\)/.test(source),
    'a media query would track the OS rather than the page');
});

test('a mid-grey page is judged by luminance, not by guesswork', t => {
  const darkish = page({ bodyBackground: 'rgb(60, 60, 60)' });
  t.after(() => darkish.dom.window.close());
  assert.equal(themeOf(darkish), 'dark');

  const lightish = page({ bodyBackground: 'rgb(200, 200, 200)' });
  t.after(() => lightish.dom.window.close());
  assert.equal(themeOf(lightish), 'light');
});

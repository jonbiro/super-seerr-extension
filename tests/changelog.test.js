// The version only advances when `make build` runs, so it is easy to invent
// changelog headings for versions that were never produced.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const versions = () => [...fs.readFileSync('CHANGELOG.md', 'utf8').matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map(m => m[1]);
const parse = version => version.split('.').map(Number);

// -1, 0 or 1, like a comparator.
function compare(a, b) {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

test('the newest changelog entry is not ahead of the built version', () => {
  const current = JSON.parse(fs.readFileSync('manifest.base.json', 'utf8')).version;
  const [newest] = versions();
  assert.ok(newest, 'the changelog should have at least one version heading');
  assert.ok(compare(newest, current) <= 0, `changelog documents ${newest} but the manifest is at ${current}`);
});

test('changelog versions are unique and strictly descending', () => {
  const listed = versions();
  assert.equal(new Set(listed).size, listed.length, 'duplicate version headings');
  for (let i = 1; i < listed.length; i++) {
    assert.ok(compare(listed[i - 1], listed[i]) > 0, `${listed[i - 1]} should come after ${listed[i]}`);
  }
});

test('the manifest, package and README badge agree on the version', () => {
  const manifest = JSON.parse(fs.readFileSync('manifest.base.json', 'utf8')).version;
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
  const badge = fs.readFileSync('README.md', 'utf8').match(/badge\/version-([\d.]+)-blue/);
  assert.equal(pkg, manifest, 'package.json is out of step with the manifest');
  assert.ok(badge, 'README should carry a version badge');
  assert.equal(badge[1], manifest, 'README badge is out of step with the manifest');
});

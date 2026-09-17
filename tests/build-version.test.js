const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
test('builds bump once per invocation and share version across browsers and release names', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'super-seerr-build-'));
  try {
    for (const file of ['Makefile', 'scripts', 'manifest.base.json', 'manifest.chrome.json', 'manifest.firefox.json', 'package.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'src', 'icons']) {
      fs.cpSync(path.join(root, file), path.join(temp, file), { recursive: true });
    }
    const read = name => JSON.parse(fs.readFileSync(path.join(temp, name), 'utf8'));
    const base = read('manifest.base.json');
    base.version = '3.1.1';
    fs.writeFileSync(path.join(temp, 'manifest.base.json'), JSON.stringify(base));
    fs.writeFileSync(path.join(temp, 'package-lock.json'), JSON.stringify({ name: 'old', version: '3.1.1', packages: { '': { name: 'old', version: '3.1.1' } } }));
    const make = (...args) => execFileSync('make', args, { cwd: temp, stdio: 'pipe' });
    const verify = version => {
      assert.equal(read('manifest.base.json').version, version);
      assert.equal(read('package.json').version, version);
      assert.equal(read('package-lock.json').packages[''].version, version);
      assert.match(fs.readFileSync(path.join(temp, 'README.md'), 'utf8'), new RegExp(`badge/version-${version.replaceAll('.', '\\.')}-blue`));
    };
    make('-j4', 'build');
    verify('3.1.2');
    for (const browser of ['chrome', 'firefox']) {
      const built = read(`dist/${browser}/manifest.json`);
      assert.equal(built.name, 'Super Seerr');
      assert.equal(built.action.default_title, 'Super Seerr');
      assert.equal(built.version, '3.1.2');
    }
    make('build-chrome');
    verify('3.1.3');
    assert.equal(read('dist/chrome/manifest.json').version, '3.1.3');
    make('build-firefox');
    verify('3.1.4');
    assert.equal(read('dist/firefox/manifest.json').version, '3.1.4');
    make('-j4', 'release');
    verify('3.1.5');
    for (const [browser, ext] of [['chrome', 'zip'], ['firefox', 'xpi']]) {
      const archive = path.join(temp, `super-seerr-v3.1.5-${browser}.${ext}`);
      assert.ok(fs.existsSync(archive));
      const packaged = JSON.parse(execFileSync('unzip', ['-p', archive, 'manifest.json'], { encoding: 'utf8' }));
      assert.equal(packaged.version, '3.1.5');
      assert.equal(packaged.name, 'Super Seerr');
    }
    make('clean');
    verify('3.1.5');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

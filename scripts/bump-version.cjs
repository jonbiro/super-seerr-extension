const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const readJson = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const manifest = readJson('manifest.base.json');
const pkg = readJson('package.json');
const parts = manifest.version.split('.').map(Number);
if (parts.length !== 3 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 65535)) {
  throw new Error(`Expected a three-part numeric extension version; got ${manifest.version}`);
}
if (parts[2] === 65535) throw new Error('Patch version is exhausted; advance the minor version before building.');
parts[2]++;
const version = parts.join('.');
manifest.version = version;
pkg.version = version;
const updates = new Map([
  ['manifest.base.json', JSON.stringify(manifest, null, 2) + '\n'],
  ['package.json', JSON.stringify(pkg, null, 2) + '\n']
]);
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
updates.set('README.md', readme.replace(/badge\/version-[\d.]+-blue/, `badge/version-${version}-blue`));
const lockPath = path.join(root, 'package-lock.json');
if (fs.existsSync(lockPath)) {
  const lock = readJson('package-lock.json');
  lock.name = pkg.name;
  lock.version = version;
  if (lock.packages?.['']) {
    lock.packages[''].name = pkg.name;
    lock.packages[''].version = version;
  }
  updates.set('package-lock.json', JSON.stringify(lock, null, 2) + '\n');
}
for (const [name, content] of updates) fs.writeFileSync(path.join(root, name), content);
console.log(`Building ${manifest.name} v${version}`);

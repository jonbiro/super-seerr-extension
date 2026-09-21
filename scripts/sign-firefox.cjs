// Credentials are consumed by web-ext through environment variables, never
// included in command arguments or diagnostic output. This does not publish.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const source = require('../manifest.base.json');
const { distributionManifest, assertPreparedManifest } = require('./firefox-distribution.cjs');
if (!process.env.WEB_EXT_API_KEY || !process.env.WEB_EXT_API_SECRET) {
  console.error('Set WEB_EXT_API_KEY and WEB_EXT_API_SECRET from your Mozilla account to sign the prepared Firefox build.'); process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync('dist/firefox/manifest.json', 'utf8'));
assertPreparedManifest(manifest, { ...source, ...require('../manifest.firefox.json') });
for (const file of fs.readdirSync('src', { recursive: true }).filter(file => fs.statSync(`src/${file}`).isFile())) {
  if (!fs.readFileSync(`src/${file}`).equals(fs.readFileSync(`dist/firefox/src/${file}`))) throw new Error('Prepared Firefox source is stale; run make release first.');
}
const signSource = 'dist/firefox-self-distributed';
fs.rmSync(signSource, { recursive: true, force: true });
fs.cpSync('dist/firefox', signSource, { recursive: true });
fs.writeFileSync(`${signSource}/manifest.json`, JSON.stringify(distributionManifest(manifest), null, 2));
const result = spawnSync('npx', ['--yes', 'web-ext@10.6.0', 'sign', '--channel=unlisted', `--source-dir=${signSource}`, '--artifacts-dir=dist/signed-firefox'], { stdio: 'inherit', env: process.env });
process.exit(result.status ?? 1);

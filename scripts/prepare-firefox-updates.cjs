// Run only on an artifact returned by Mozilla signing. Signature-file checks
// guard accidental unsigned input; Firefox remains the signature verifier.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { updatesFor } = require('./firefox-distribution.cjs');
const source = require('../manifest.base.json');
const id = require('../manifest.firefox.json').browser_specific_settings.gecko.id;
const artifact = process.argv[2];
if (!artifact || process.argv.length !== 3) throw new Error('Provide the Mozilla-signed XPI path.');
const manifest = JSON.parse(execFileSync('unzip', ['-p', path.resolve(artifact), 'manifest.json'], { encoding: 'utf8' }));
if (manifest.version !== source.version || manifest.browser_specific_settings?.gecko?.id !== id) throw new Error('Artifact identity/version differs from this checkout');
const members = execFileSync('unzip', ['-Z1', path.resolve(artifact)], { encoding: 'utf8' }).split('\n');
if (!members.some(name => /^META-INF\/(mozilla\.rsa|cose\.sig)$/i.test(name))) throw new Error('Artifact has no Mozilla signature files');
const bytes = fs.readFileSync(artifact);
const { filename, updates } = updatesFor(manifest, createHash('sha256').update(bytes).digest('hex'));
const destination = 'dist/firefox-distribution';
fs.mkdirSync(destination, { recursive: true });
fs.writeFileSync(path.join(destination, filename), bytes);
fs.writeFileSync(path.join(destination, 'updates.json'), JSON.stringify(updates, null, 2) + '\n');
console.log(`Prepared ${destination}/updates.json and ${filename}. Publish both under release v${manifest.version} before claiming automatic updates work.`);

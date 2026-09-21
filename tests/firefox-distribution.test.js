const { test } = require('node:test');
const assert = require('node:assert/strict');
const { distributionManifest, updatesFor, updateUrl, assertPreparedManifest } = require('../scripts/firefox-distribution.cjs');
const base = require('../manifest.base.json');
const firefox = require('../manifest.firefox.json');
test('self-distribution preserves identity and supplies matching version and download hash', () => {
  const input = { ...base, ...firefox };
  const manifest = distributionManifest(input);
  assert.equal(input.browser_specific_settings.gecko.update_url, undefined);
  assert.equal(manifest.browser_specific_settings.gecko.update_url, updateUrl);
  assert.equal(manifest.browser_specific_settings.gecko.id, firefox.browser_specific_settings.gecko.id);
  const result = updatesFor(manifest, 'a'.repeat(64));
  const entry = result.updates.addons[manifest.browser_specific_settings.gecko.id].updates[0];
  assert.equal(entry.version, base.version);
  assert.equal(entry.update_hash, `sha256:${'a'.repeat(64)}`);
  assert.ok(entry.update_link.endsWith(`/v${base.version}/${result.filename}`));
  assert.equal(entry.applications.gecko.strict_min_version, firefox.browser_specific_settings.gecko.strict_min_version);
  assert.throws(() => updatesFor(input, 'a'.repeat(64)), /wrong update URL/);
  assert.throws(() => updatesFor(manifest, 'bad'), /Invalid update metadata/);
});

test('update preparation rejects an unsigned archive before producing metadata', t => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { execFileSync, spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seerr-unsigned-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(distributionManifest({ ...base, ...firefox })));
  execFileSync('zip', ['unsigned.xpi', 'manifest.json'], { cwd: dir });
  const result = spawnSync(process.execPath, ['scripts/prepare-firefox-updates.cjs', path.join(dir, 'unsigned.xpi')], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no Mozilla signature files/);
});


test('signing refuses changed permissions or identity even at the same version', () => {
  const expected = { ...base, ...firefox };
  assert.doesNotThrow(() => assertPreparedManifest(structuredClone(expected), expected));
  const stale = structuredClone(expected); stale.permissions.push('unexpected-permission');
  assert.throws(() => assertPreparedManifest(stale, expected), /manifest differs from source/);
  const renamed = structuredClone(expected); renamed.browser_specific_settings.gecko.id = 'wrong@example.com';
  assert.throws(() => assertPreparedManifest(renamed, expected), /manifest differs from source/);
});

test('update CLI copies exact artifact bytes and hashes them in the prepared feed', t => {
  // Synthetic signature marker exercises packaging only; it is not Mozilla signing.
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { execFileSync, spawnSync } = require('node:child_process');
  const { createHash } = require('node:crypto');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seerr-update-fixture-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const manifest = distributionManifest({ ...base, ...firefox });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  fs.mkdirSync(path.join(dir, 'META-INF'));
  fs.writeFileSync(path.join(dir, 'META-INF/mozilla.rsa'), 'SYNTHETIC TEST MARKER - NOT A SIGNATURE');
  execFileSync('zip', ['fixture.xpi', 'manifest.json', 'META-INF/mozilla.rsa'], { cwd: dir });
  const artifact = path.join(dir, 'fixture.xpi');
  const result = spawnSync(process.execPath, [path.resolve('scripts/prepare-firefox-updates.cjs'), artifact], { cwd: dir, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const output = path.join(dir, 'dist/firefox-distribution');
  const feed = JSON.parse(fs.readFileSync(path.join(output, 'updates.json')));
  const update = feed.addons[manifest.browser_specific_settings.gecko.id].updates[0];
  const bytes = fs.readFileSync(artifact);
  assert.equal(update.version, manifest.version);
  assert.equal(update.update_hash, `sha256:${createHash('sha256').update(bytes).digest('hex')}`);
  assert.deepEqual(fs.readFileSync(path.join(output, path.basename(new URL(update.update_link).pathname))), bytes);
});

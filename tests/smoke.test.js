// Smoke tests: verify no stale Jellyseerr identifiers remain in the codebase
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC_DIR = path.join(__dirname, '..', 'src');
const ROOT_DIR = path.join(__dirname, '..');
const DOCS_DIR = path.join(__dirname, '..', 'docs');

function readAllFiles(dir, pattern, exclude = []) {
  const results = [];
  const entries = fs.readdirSync(dir, { recursive: true, withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile()) continue;
    const relPath = path.relative(ROOT_DIR, path.join(e.parentPath || dir, e.name));
    if (exclude.some(x => relPath.includes(x))) continue;
    if (pattern && !relPath.match(pattern)) continue;
    results.push(relPath);
  }
  return results.sort();
}

test('SeerrClient.js exists', () => {
  const p = path.join(SRC_DIR, 'shared', 'SeerrClient.js');
  assert.ok(fs.existsSync(p), 'src/shared/SeerrClient.js should exist');
});

test('JellyseerrClient.js does NOT exist', () => {
  const p = path.join(SRC_DIR, 'shared', 'JellyseerrClient.js');
  assert.ok(!fs.existsSync(p), 'src/shared/JellyseerrClient.js should not exist');
});

test('No stale Jellyseerr identifiers in source (.js, .html, .css)', () => {
  const banned = ['JellyseerrClient', 'JellyseerrAPI', 'jellyseerrUrl', 'jellyseerrApiKey', 'window.jellyseerr_debug'];
  const browserFiles = readAllFiles(SRC_DIR, /\.(js|html|css)$/);
  const failures = [];

  for (const file of browserFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    for (const term of banned) {
      if (content.includes(term)) {
        // Allow old storage key strings ONLY in migrateStorage() context (background.js)
        if ((term === 'jellyseerrUrl' || term === 'jellyseerrApiKey') && file.includes('background.js')) {
          // Only permit inside migrateStorage — check behind that it's reading old keys for migration
          const migrateIdx = content.indexOf('migrateStorage');
          const termIdx = content.indexOf(term);
          if (migrateIdx !== -1 && termIdx > migrateIdx) continue;
        }
        failures.push(`${file}: contains '${term}'`);
      }
    }
    // Check user-visible "Jellyseerr" strings (not Jellyfin)
    const jellyseerrStrings = content.match(/"(.*?Jellyseerr.*?)"|'(.*?Jellyseerr.*?)'/g) || [];
    for (const s of jellyseerrStrings) {
      if (s.includes('Jellyfin')) continue;  // Jellyfin is allowed
      failures.push(`${file}: contains Jellyseerr string ${s}`);
    }
  }

  assert.deepStrictEqual(failures, [], 'All stale Jellyseerr identifiers must be removed from source');
});

test('Manifest uses SeerrClient.js in all content_scripts entries', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'manifest.base.json'), 'utf-8'));
  assert.strictEqual(manifest.name, 'Super Seerr');
  assert.strictEqual(manifest.action.default_title, 'Super Seerr');
  assert.ok(!manifest.description.includes('Jellyseerr'), 'Description should not mention Jellyseerr');

  for (const entry of manifest.content_scripts) {
    for (const js of entry.js) {
      assert.ok(!js.includes('JellyseerrClient'), `${js} should not reference JellyseerrClient`);
      if (js.includes('Client')) {
        assert.ok(js.includes('SeerrClient'), `${js} should reference SeerrClient`);
      }
    }
  }
});

test('Manifest Firefox uses seerr gecko ID', () => {
  const ff = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'manifest.firefox.json'), 'utf-8'));
  assert.strictEqual(ff.browser_specific_settings.gecko.id, 'super-seerr@jonbiro.github.io');
});

test('HTML files use Seerr branding', () => {
  const optionsHtml = fs.readFileSync(path.join(SRC_DIR, 'options', 'options.html'), 'utf-8');
  assert.ok(optionsHtml.includes('Super Seerr - Settings'), 'options.html title');
  assert.ok(optionsHtml.includes('<h1>Super Seerr</h1>'), 'options.html h1');
  assert.ok(optionsHtml.includes('Configure your Seerr server connection'), 'options.html subtitle');
  assert.ok(optionsHtml.includes('Seerr Server URL'), 'options.html label');
  assert.ok(optionsHtml.includes('https://seerr.example.com'), 'options.html placeholder');
  assert.ok(optionsHtml.includes('from Seerr Settings'), 'options.html help text');
  assert.ok(optionsHtml.includes('https://github.com/jonbiro/super-seerr-extension/issues'), 'options.html footer link');

  const popupHtml = fs.readFileSync(path.join(SRC_DIR, 'popup', 'popup.html'), 'utf-8');
  assert.ok(popupHtml.includes('Super Seerr'), 'popup.html title');
  assert.ok(popupHtml.includes('<h1>Super Seerr</h1>'), 'popup.html h1');
  // Branding, not wording: pinning the whole sentence made every copy edit a
  // failure. What matters here is that the configured state names Seerr.
  assert.match(popupHtml, /id="configuredDetail"[^>]*>[^<]*Seerr/, 'popup.html configured state names Seerr');
  assert.ok(popupHtml.includes('Connect Your Seerr Server'), 'popup.html not-configured state');
  assert.ok(popupHtml.includes('Unable to connect to your Seerr server'), 'popup.html error state');
});

test('the watch action names no product it has not confirmed', () => {
  // Superseded rule: a source file used to be required to contain the literal
  // "Watch on Jellyfin". Seerr supports Plex, Jellyfin and Emby, so the label
  // is now built from the server's reported mediaServerType.
  for (const file of readAllFiles(SRC_DIR, /\.js$/)) {
    const content = fs.readFileSync(file, 'utf-8');
    assert.ok(!content.includes('Watch on Jellyfin'), `${file} hardcodes a media server`);
  }
  const worker = fs.readFileSync(path.join(SRC_DIR, 'background', 'background.js'), 'utf-8');
  assert.ok(worker.includes('mediaServerType'), 'the worker should read the configured server type');
});

test('Project-level files use Seerr branding', () => {
  const readme = fs.readFileSync(path.join(ROOT_DIR, 'README.md'), 'utf-8');
  assert.ok(readme.includes('# Super Seerr'), 'README title');
  assert.ok(!readme.includes('Jellyseerr Request Button'), 'README should not have old title');
  assert.ok(readme.includes('SeerrClient.js'), 'README architecture references SeerrClient');

  const changelog = fs.readFileSync(path.join(ROOT_DIR, 'CHANGELOG.md'), 'utf-8');
  assert.ok(changelog.includes('Super Seerr'), 'CHANGELOG header');
  assert.ok(changelog.includes('SeerrClient'), 'CHANGELOG architecture references SeerrClient');

  const makefile = fs.readFileSync(path.join(ROOT_DIR, 'Makefile'), 'utf-8');
  assert.ok(makefile.includes('NAME = super-seerr'), 'Makefile NAME variable');
});

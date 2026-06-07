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
  assert.strictEqual(manifest.name, 'Seerr Request Button');
  assert.strictEqual(manifest.action.default_title, 'Seerr Request Button');
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
  assert.strictEqual(ff.browser_specific_settings.gecko.id, 'seerr-request-button@example.com');
});

test('HTML files use Seerr branding', () => {
  const optionsHtml = fs.readFileSync(path.join(SRC_DIR, 'options', 'options.html'), 'utf-8');
  assert.ok(optionsHtml.includes('Seerr Request Button - Settings'), 'options.html title');
  assert.ok(optionsHtml.includes('<h1>Seerr Request Button</h1>'), 'options.html h1');
  assert.ok(optionsHtml.includes('Configure your Seerr server connection'), 'options.html subtitle');
  assert.ok(optionsHtml.includes('Seerr Server URL'), 'options.html label');
  assert.ok(optionsHtml.includes('https://seerr.example.com'), 'options.html placeholder');
  assert.ok(optionsHtml.includes('from Seerr Settings'), 'options.html help text');
  assert.ok(optionsHtml.includes('seerr-browser-extension'), 'options.html footer link');

  const popupHtml = fs.readFileSync(path.join(SRC_DIR, 'popup', 'popup.html'), 'utf-8');
  assert.ok(popupHtml.includes('Seerr Request Button'), 'popup.html title');
  assert.ok(popupHtml.includes('<h1>Seerr</h1>'), 'popup.html h1');
  assert.ok(popupHtml.includes('The Seerr request button'), 'popup.html configured state');
  assert.ok(popupHtml.includes('configure'), 'popup.html not-configured state');
  assert.ok(popupHtml.includes('Unable to connect to your Seerr server'), 'popup.html error state');
});

test('"Watch on Jellyfin" is preserved', () => {
  const files = readAllFiles(SRC_DIR, /\.js$/);
  let foundJellyfin = false;
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    if (content.includes('Watch on Jellyfin')) {
      foundJellyfin = true;
      break;
    }
  }
  assert.ok(foundJellyfin, 'At least one source file should still contain "Watch on Jellyfin"');
});

test('Project-level files use Seerr branding', () => {
  const readme = fs.readFileSync(path.join(ROOT_DIR, 'README.md'), 'utf-8');
  assert.ok(readme.includes('# Seerr Request Button'), 'README title');
  assert.ok(!readme.includes('Jellyseerr Request Button'), 'README should not have old title');
  assert.ok(readme.includes('SeerrClient.js'), 'README architecture references SeerrClient');

  const changelog = fs.readFileSync(path.join(ROOT_DIR, 'CHANGELOG.md'), 'utf-8');
  assert.ok(changelog.includes('Seerr Request Button'), 'CHANGELOG header');
  assert.ok(changelog.includes('SeerrClient'), 'CHANGELOG architecture references SeerrClient');

  const makefile = fs.readFileSync(path.join(ROOT_DIR, 'Makefile'), 'utf-8');
  assert.ok(makefile.includes('NAME = seerr-browser-extension'), 'Makefile NAME variable');
});

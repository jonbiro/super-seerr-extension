// Property tests 3, 4, 5: Branding correctness
// - Property 3: Button text never references old brand (Requirement 6.1)
// - Property 4: Status response button text references new brand (Requirement 6.2)
// - Property 5: "Watch on Jellyfin" is preserved (Requirement 10.1/10.2)
const { test } = require('node:test');
const assert = require('node:assert');
const fc = require('fast-check');

test('Property 3: Button text never references old brand', () => {
  // Verify that the button creation path uses "Seerr" not "Jellyseerr"
  // This is a structural test — the source file must not contain the old default text
  const fs = require('fs');
  const path = require('path');

  const files = [
    'src/shared/BaseIntegration.js',
    'src/shared/UIComponents.js',
  ];

  for (const file of files) {
    const content = fs.readFileSync(path.join(__dirname, '..', file), 'utf-8');
    assert.ok(
      !content.includes("'Request on Jellyseerr'") && !content.includes('"Request on Jellyseerr"'),
      `${file} should not contain old button text`
    );
    assert.ok(
      content.includes("'Request on Seerr'"),
      `${file} should contain new button text`
    );
  }
});

test('Property 4: SeerrClient error message references Seerr not Jellyseerr', () => {
  const fs = require('fs');
  const path = require('path');
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'SeerrClient.js'), 'utf-8');

  assert.ok(content.includes('Cannot connect to Seerr server'), 'Error message should reference Seerr');
  assert.ok(!content.includes('Cannot connect to Jellyseerr server'), 'Error message should NOT reference Jellyseerr');
});

test('Property 5: "Watch on Jellyfin" is preserved in background.js', () => {
  // For any status code 5 (available) with a non-empty mediaUrl,
  // the formatMediaStatus should return buttonText === "Watch on Jellyfin"

  // This is a structural check — the source must contain the Watch on Jellyfin string
  // and must not accidentally rename it
  const fs = require('fs');
  const path = require('path');
  const bgContent = fs.readFileSync(path.join(__dirname, '..', 'src', 'background', 'background.js'), 'utf-8');

  assert.ok(bgContent.includes("'Watch on Jellyfin'"), 'background.js should preserve Watch on Jellyfin');

  // Also check BaseIntegration.js
  const baseContent = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'BaseIntegration.js'), 'utf-8');
  assert.ok(baseContent.includes("'Watch on Jellyfin'"), 'BaseIntegration.js should preserve Watch on Jellyfin');

  // Verify there's no accidental "Watch on Seerr" variant
  assert.ok(!bgContent.includes("'Watch on Seerr'"), 'Should not have Watch on Seerr');
  assert.ok(!baseContent.includes("'Watch on Seerr'"), 'Should not have Watch on Seerr');
});

test('Property: No "Jellyseerr" user-visible strings remain anywhere in source', () => {
  const fs = require('fs');
  const path = require('path');

  const srcDir = path.join(__dirname, '..', 'src');
  const entries = fs.readdirSync(srcDir, { recursive: true, withFileTypes: true });

  const failures = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!e.name.match(/\.(js|html|css)$/)) continue;
    const filePath = path.join(e.parentPath || srcDir, e.name);
    const content = fs.readFileSync(filePath, 'utf-8');

    // Check for user-visible Jellyseerr strings (single/double quoted)
    const quotedJellyseerr = content.match(/['"][^'"]*Jellyseerr[^'"]*['"]/g) || [];
    for (const match of quotedJellyseerr) {
      if (match.includes('Jellyfin')) continue;
      // Allow old storage key strings in migrateStorage
      if (match.includes('jellyseerrUrl') || match.includes('jellyseerrApiKey')) continue;
      failures.push(`${path.relative(path.join(__dirname, '..'), filePath)}: ${match}`);
    }

    // Check for '/* Jellyseerr */' style comments
    if (content.includes('/* Jellyseerr')) {
      failures.push(`${path.relative(path.join(__dirname, '..'), filePath)}: Jellyseerr in comment`);
    }
  }

  assert.deepStrictEqual(failures, [], 'No Jellyseerr user-visible strings should remain');
});

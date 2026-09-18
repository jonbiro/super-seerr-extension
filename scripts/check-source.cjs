const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function visit(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) visit(file);
    else if (file.endsWith('.js')) {
      const source = fs.readFileSync(file, 'utf8');
      execFileSync(process.execPath, ['--check', '--input-type=module'], { input: source, stdio: ['pipe', 'pipe', 'pipe'] });
      for (const [, dependency] of source.matchAll(/^import\s+(?:[^'"\n]+from\s+)?['"]([^'"]+)['"]/gm)) {
        const target = path.resolve(path.dirname(file), dependency);
        if (!dependency.startsWith('.') || !fs.existsSync(target)) throw new Error(`${file}: missing local module ${dependency}`);
      }
    }
  }
}
visit(path.join(root, 'src'));

// The overlay is registered at runtime, so its files are named in the worker
// rather than in the manifest. Parse them out so a rename still fails the check.
function dynamicOverlayFiles() {
  const source = fs.readFileSync(path.join(root, 'src/background/background.js'), 'utf8');
  const blocks = [...source.matchAll(/const \w+_SCRIPT_FILES = \{([\s\S]*?)\n?\};/g)];
  if (blocks.length === 0) throw new Error('Could not find any *_SCRIPT_FILES in the background worker');
  const files = blocks.flatMap(block => [...block[1].matchAll(/'([^']+\.(?:js|css))'/g)].map(match => match[1]));
  if (files.length === 0) throw new Error('OVERLAY_SCRIPT_FILES listed no files');
  return files;
}

for (const browser of ['chrome', 'firefox']) {
  const base = JSON.parse(fs.readFileSync(path.join(root, 'manifest.base.json')));
  const override = JSON.parse(fs.readFileSync(path.join(root, `manifest.${browser}.json`)));
  const manifest = { ...base, ...override };
  const files = manifest.content_scripts.flatMap(entry => [...(entry.js || []), ...(entry.css || [])]);
  files.push(...(manifest.background.scripts || []));
  if (manifest.background.service_worker) files.push(manifest.background.service_worker);
  files.push(...dynamicOverlayFiles());
  for (const file of files) if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing ${file}`);

  // Dynamic registration only works if the worker can actually request the origin.
  if (!manifest.permissions.includes('scripting')) throw new Error(`${browser}: missing "scripting" permission`);
  if (!(manifest.optional_host_permissions || []).some(pattern => pattern.startsWith('https://'))) {
    throw new Error(`${browser}: no optional https host permission for the Seerr origin`);
  }
  const wildcard = (manifest.host_permissions || []).filter(pattern => /^https?:\/\/\*\/\*$/.test(pattern));
  if (wildcard.length > 0) throw new Error(`${browser}: all-sites host permission should be optional, found ${wildcard.join(', ')}`);
}
console.log('Source syntax, module imports, and manifest paths verified.');

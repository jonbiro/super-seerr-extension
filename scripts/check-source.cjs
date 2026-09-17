const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function visit(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) visit(file);
    else if (file.endsWith('.js')) execFileSync(process.execPath, ['--check', '--input-type=module'], { input: fs.readFileSync(file), stdio: ['pipe', 'pipe', 'pipe'] });
  }
}
visit(path.join(root, 'src'));
for (const browser of ['chrome', 'firefox']) {
  const base = JSON.parse(fs.readFileSync(path.join(root, 'manifest.base.json')));
  const override = JSON.parse(fs.readFileSync(path.join(root, `manifest.${browser}.json`)));
  const manifest = { ...base, ...override };
  const files = manifest.content_scripts.flatMap(entry => [...(entry.js || []), ...(entry.css || [])]);
  files.push(...(manifest.background.scripts || []));
  if (manifest.background.service_worker) files.push(manifest.background.service_worker);
  for (const file of files) if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing ${file}`);
}
console.log('Source syntax and manifest paths verified.');

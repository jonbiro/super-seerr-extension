const fs = require('node:fs');
const crypto = require('node:crypto');
const version = require('../manifest.base.json').version;
const files = [`super-seerr-v${version}-chrome.zip`, `super-seerr-v${version}-firefox.xpi`];
const checksums = files.map(file => `${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}  ${file}`).join('\n') + '\n';
fs.writeFileSync(`super-seerr-v${version}-SHA256SUMS.txt`, checksums);
console.log(checksums);

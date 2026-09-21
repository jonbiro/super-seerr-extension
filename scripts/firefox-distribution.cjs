// Stable self-distribution location; publishing is a separate release gate.
const base = 'https://github.com/jonbiro/super-seerr-extension/releases';
const updateUrl = `${base}/latest/download/updates.json`;
function distributionManifest(manifest) {
  const copy = structuredClone(manifest);
  copy.browser_specific_settings.gecko.update_url = updateUrl;
  return copy;
}
function updatesFor(manifest, hash) {
  if (manifest.browser_specific_settings?.gecko?.update_url !== updateUrl) throw new Error('Signed artifact has the wrong update URL');
  if (!/^\d+(\.\d+){1,3}$/.test(manifest.version) || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid update metadata');
  const gecko = manifest.browser_specific_settings.gecko;
  const filename = `super-seerr-v${manifest.version}-firefox-signed.xpi`;
  return { filename, updates: { addons: { [gecko.id]: { updates: [{ version: manifest.version,
    update_link: `${base}/download/v${manifest.version}/${filename}`, update_hash: `sha256:${hash}`,
    applications: { gecko: { strict_min_version: gecko.strict_min_version } }
  }] } } } };
}
module.exports = { updateUrl, distributionManifest, updatesFor };

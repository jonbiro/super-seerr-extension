const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const files = ['OverlayCache', 'RatingsPresentation', 'SeerrSession', 'FilterPresets'];
function loadOverlayModules(window) {
  for (const file of files) window.eval(fs.readFileSync(path.join(__dirname, `../../src/content/${file}.js`), 'utf8'));
}
function loadOverlayModulesInContext(context) {
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(__dirname, `../../src/content/${file}.js`), 'utf8'), context);
}
module.exports = { loadOverlayModules, loadOverlayModulesInContext };

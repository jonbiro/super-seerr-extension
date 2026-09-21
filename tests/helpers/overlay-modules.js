const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const files = ['OverlayCache', 'RatingsPresentation', 'SeerrSession', 'FilterPresets', 'RatingQueue'];
function loadOverlayModules(window) {
  window.eval(fs.readFileSync(path.join(__dirname, '../../src/shared/NotificationCenter.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '../../src/shared/SeasonPicker.js'), 'utf8'));
  for (const file of files) window.eval(fs.readFileSync(path.join(__dirname, `../../src/content/${file}.js`), 'utf8'));
}
function loadOverlayModulesInContext(context) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/shared/NotificationCenter.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/shared/SeasonPicker.js'), 'utf8'), context);
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(__dirname, `../../src/content/${file}.js`), 'utf8'), context);
}
module.exports = { loadOverlayModules, loadOverlayModulesInContext };

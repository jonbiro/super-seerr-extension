const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const files = ['OverlayCache', 'RatingsPresentation', 'SeerrSession'];
function loadOverlayModules(window) {
  for (const file of files) window.eval(fs.readFileSync(path.join(__dirname, `../../src/content/${file}.js`), 'utf8'));
}
function loadOverlayModulesInContext(context) {
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(__dirname, `../../src/content/${file}.js`), 'utf8'), context);
  for (const key of ['createOverlayCache', 'createRatingsPresentation', 'createSeerrSession']) context.window[key] = context[key];
}
module.exports = { loadOverlayModules, loadOverlayModulesInContext };

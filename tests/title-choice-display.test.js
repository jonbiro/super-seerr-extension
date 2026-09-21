const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadIntegration } = require('./helpers/integration');
for (const year of [2011, null]) {
  test(`choosing another match updates the visible year to ${year}`, async t => {
    const f = loadIntegration(); t.after(() => f.window.close());
    const integration = new f.window.BaseIntegration('Probe', {uiTheme:'flyout'});
    t.after(() => integration.destroy());
    integration.mediaData = { title:'The Thing', year:1982, mediaType:'movie' };
    integration.updateStatus = async () => {};
    await integration.setupUI();
    integration.client.sendMessage = async () => ({success:true,data:[]});
    integration.ui.chooseTitle = async () => ({title:'The Thing',year,mediaType:'movie',tmdbId:60935});
    await integration.handleTitleChoice();
    assert.equal(f.window.document.querySelector('.seerr-title').textContent, 'The Thing');
    assert.equal(f.window.document.querySelector('.seerr-year').textContent, `${year || 'Unknown Year'} • Movie`);
  });
}

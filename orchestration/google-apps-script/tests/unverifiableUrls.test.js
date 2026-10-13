const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppsScript } = require('./helpers/loadAppsScript');

const api = loadAppsScript(
  ['Config.js', 'Utils.js', 'UrlInspector.js'],
  ['isUnverifiableUrl_', 'isFacebookSourceId_', 'isSpecificOpportunityUrl_'],
  { SpreadsheetApp: {}, Utilities: {}, UrlFetchApp: {} }
);

test('a Facebook post is treated as unreadable whatever the host spelling', () => {
  [
    'https://www.facebook.com/groups/1008911699849849/posts/1493222484082107/',
    'https://facebook.com/groups/abc/permalink/123456/',
    'https://m.facebook.com/groups/abc/posts/1/',
    'https://web.facebook.com/somepage/posts/99/',
  ].forEach((url) => {
    assert.equal(api.isUnverifiableUrl_(url), true, `${url} should be unverifiable`);
  });
});

test('ordinary job pages stay verifiable, including lookalike hostnames', () => {
  [
    'https://job-boards.greenhouse.io/similarweb/jobs/7556263',
    'https://www.drushim.co.il/job/12345/',
    'https://notfacebook.com/posts/1',
    'https://facebook.com.evil.example/posts/1',
  ].forEach((url) => {
    assert.equal(api.isUnverifiableUrl_(url), false, `${url} should be verifiable`);
  });
});

test('Facebook sources are recognised by the fb_ ids the catalog actually uses', () => {
  ['fb_marketing_il', 'fb_ai_il', 'facebook_legacy', 'facebook_group'].forEach((id) => {
    assert.equal(api.isFacebookSourceId_(id), true, `${id} should count as a Facebook source`);
  });
  ['il_mploy', 'web_freelance_projects', 'api_ats_boards', 'il_drushim', ''].forEach((id) => {
    assert.equal(api.isFacebookSourceId_(id), false, `${id} should not count as a Facebook source`);
  });
});

test('the reported post is a specific URL, so shape alone was never going to stop it', () => {
  const url = 'https://www.facebook.com/groups/1008911699849849/posts/1493222484082107/';
  assert.equal(api.isSpecificOpportunityUrl_(url, 'Freelance'), true);
  assert.equal(api.isUnverifiableUrl_(url), true, 'provenance is what must reject it');
});

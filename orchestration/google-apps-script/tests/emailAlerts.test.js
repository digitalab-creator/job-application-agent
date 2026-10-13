const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppsScript } = require('./helpers/loadAppsScript');

const api = loadAppsScript(
  ['Config.js', 'Utils.js', 'EmailAlerts.js'],
  ['extractAlertJobLinks_', 'unwrapTrackingUrl_', 'ALERT_BOARDS'],
  { SpreadsheetApp: {}, Utilities: {}, GmailApp: {} }
);

// Values cross the VM boundary, so copy into a host array before comparing.
function links(html) {
  return Array.from(api.extractAlertJobLinks_(html));
}

function urls(html) {
  return links(html).map((link) => link.url);
}

test('a LinkedIn alert yields canonical posting URLs, stripped of tracking', () => {
  const html = `
    <a href="https://www.linkedin.com/comm/jobs/view/4012345678?trk=eml-jobs_alert&amp;lipi=xyz">
      Senior Growth Marketing Manager
    </a>
    <a href="https://www.linkedin.com/comm/jobs/view/4087654321?trk=eml">AI Engineer</a>`;

  const found = links(html);
  assert.deepEqual(found.map((item) => item.url), [
    'https://www.linkedin.com/jobs/view/4012345678/',
    'https://www.linkedin.com/jobs/view/4087654321/',
  ]);
  assert.equal(found[0].board, 'linkedin');
  assert.equal(found[0].title, 'Senior Growth Marketing Manager');
});

test('the Israeli boards and Indeed are each recognised', () => {
  const html = `
    <a href="https://www.alljobs.co.il/Search/UploadSingle.aspx?JobID=7654321">PPC Manager</a>
    <a href="https://il.indeed.com/rc/clk?jk=a1b2c3d4e5f60718&amp;from=alert">Growth Lead</a>
    <a href="https://www.drushim.co.il/job/998877/">Performance Marketer</a>
    <a href="https://www.jobmaster.co.il/jobs/senior-developer-554433/">Senior Developer</a>`;

  assert.deepEqual(urls(html), [
    'https://www.alljobs.co.il/Search/UploadSingle.aspx?JobID=7654321',
    'https://il.indeed.com/viewjob?jk=a1b2c3d4e5f60718',
    'https://www.drushim.co.il/job/998877/',
    'https://www.jobmaster.co.il/job/554433/',
  ]);
});

test('a redirector is unwrapped to the posting it points at', () => {
  const target = encodeURIComponent('https://www.linkedin.com/jobs/view/4011112222/');
  const html = `<a href="https://click.example.com/track?id=99&amp;url=${target}">Head of Growth</a>`;

  assert.deepEqual(urls(html), ['https://www.linkedin.com/jobs/view/4011112222/']);
});

test('unsubscribe, preferences and social chrome are ignored', () => {
  const html = `
    <a href="https://www.linkedin.com/comm/psettings/email-unsubscribe?tk=1">Unsubscribe</a>
    <a href="https://www.linkedin.com/jobs/view/4055556666/">Real posting</a>
    <a href="https://www.facebook.com/linkedin">Follow us</a>
    <a href="https://il.indeed.com/preferences?jk=deadbeef12345678">Manage alerts</a>`;

  assert.deepEqual(urls(html), ['https://www.linkedin.com/jobs/view/4055556666/']);
});

test('the same posting linked twice is returned once', () => {
  const html = `
    <a href="https://www.linkedin.com/comm/jobs/view/4012345678?trk=title">AI Engineer</a>
    <a href="https://www.linkedin.com/comm/jobs/view/4012345678?trk=logo">AI Engineer</a>
    <a href="https://www.linkedin.com/jobs/view/4012345678/">AI Engineer</a>`;

  assert.equal(urls(html).length, 1);
});

test('plain-text alerts with no anchors still yield postings', () => {
  const text = 'New match for your search:\n'
    + 'https://www.drushim.co.il/job/123456/\n'
    + 'Manage alerts: https://www.drushim.co.il/settings\n';

  assert.deepEqual(urls(text), ['https://www.drushim.co.il/job/123456/']);
});

test('board hub links without a posting id are not treated as jobs', () => {
  const html = `
    <a href="https://www.linkedin.com/jobs/">Browse jobs</a>
    <a href="https://www.alljobs.co.il/">AllJobs home</a>
    <a href="https://il.indeed.com/jobs?q=marketing">Search results</a>`;

  assert.deepEqual(urls(html), []);
});

test('an empty or junk body yields nothing rather than throwing', () => {
  assert.deepEqual(urls(''), []);
  assert.deepEqual(urls('<a href="mailto:someone@example.com">Mail us</a>'), []);
  assert.equal(api.unwrapTrackingUrl_('not-a-url'), '');
});

test('a malformed percent-encoded target degrades to the outer URL', () => {
  const html = '<a href="https://track.example.com/r?url=%E0%A4%A">Broken</a>';
  assert.deepEqual(urls(html), []);
});

test('every board builds a canonical URL its own pattern accepts', () => {
  Array.from(api.ALERT_BOARDS).forEach((board) => {
    const canonical = board.canonical('123456789');
    assert.match(canonical, /^https:\/\//, `${board.id} must produce an absolute URL`);
    assert.ok(board.pattern.test(canonical), `${board.id} must recognise its own canonical URL`);
  });
});

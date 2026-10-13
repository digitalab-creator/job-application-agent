const test = require('node:test');
const assert = require('node:assert/strict');
const logic = require('../lib/opportunityLogic');

const FB_MARKETING = 'https://www.facebook.com/groups/superface.marketing.digital/permalink/3087091901496316/?rdid=nBs8euDTZvI2kqlW#';
const FB_AI = 'https://www.facebook.com/groups/1027511938680919/permalink/1829493401816098/?rdid=jhxNyIkJJ6m4FXLJ#';
const FB_GROUP = 'https://www.facebook.com/groups/superface.marketing.digital/';
const GREENHOUSE = 'https://job-boards.greenhouse.io/unframe/jobs/4931573101';

test('normalizeUrl strips tracking and fragments', () => {
  const normalized = logic.normalizeUrl(FB_MARKETING);
  assert.equal(
    normalized,
    'https://www.facebook.com/groups/superface.marketing.digital/permalink/3087091901496316'
  );
});

test('facebook group roots are rejected; permalinks accepted for freelance', () => {
  assert.equal(logic.isSpecificOpportunityUrl(FB_GROUP, logic.OPPORTUNITY_TYPES.FREELANCE), false);
  assert.equal(logic.isSpecificOpportunityUrl(FB_MARKETING, logic.OPPORTUNITY_TYPES.FREELANCE), true);
  assert.equal(logic.isSpecificOpportunityUrl(FB_AI, logic.OPPORTUNITY_TYPES.JOB), true);
  assert.equal(
    logic.isSpecificOpportunityUrl('https://il.linkedin.com/jobs/search/?keywords=ai', logic.OPPORTUNITY_TYPES.JOB),
    false
  );
  assert.equal(logic.isSpecificOpportunityUrl(GREENHOUSE, logic.OPPORTUNITY_TYPES.JOB), true);
});

test('category and industry browse pages are not opportunities', () => {
  // Both slipped into a real run: they answer HTTP 200 but list many roles.
  assert.equal(logic.isListingHubUrl('https://comblack.co.il/categories/software-development/'), true);
  assert.equal(logic.isListingHubUrl('https://www.dialog.co.il/high-tech/industries/ai'), true);

  assert.equal(
    logic.isSpecificOpportunityUrl('https://comblack.co.il/categories/software-development/', logic.OPPORTUNITY_TYPES.JOB),
    false
  );
  assert.equal(
    logic.isSpecificOpportunityUrl('https://www.dialog.co.il/high-tech/industries/ai', logic.OPPORTUNITY_TYPES.JOB),
    false
  );
});

test('bare board hubs are rejected but real postings under them survive', () => {
  assert.equal(logic.isSpecificOpportunityUrl('https://acme.com/careers', logic.OPPORTUNITY_TYPES.JOB), false);
  assert.equal(logic.isSpecificOpportunityUrl('https://acme.com/jobs/?dept=eng', logic.OPPORTUNITY_TYPES.JOB), false);

  const stillValid = [
    'https://job-boards.greenhouse.io/forter/jobs/8486825002',
    'https://www.comeet.com/jobs/papayagaming/46.00B/performance-team-lead/14.E62',
    'https://wiz.co/careers/544ffd3d-55cc-4c71-88b7-ecbba2e4bc33?source=comeet',
    'https://gloat.com/careers-at-gloat/co/israel/14.E64/growth-marketing-lead-ai-native/all/',
    'https://www.alljobs.co.il/Search/UploadSingle.aspx?JobID=8692916',
    'https://www.janglo.net/item/pgiX13YyOCu',
  ];
  stillValid.forEach((url) => {
    assert.equal(
      logic.isSpecificOpportunityUrl(url, logic.OPPORTUNITY_TYPES.JOB),
      true,
      `${url} should still be accepted`
    );
  });
});

test('a taxonomy path keeps its posting when it carries a real id', () => {
  const withId = 'https://www.drushim.co.il/jobs/category/marketing/8692916/';
  assert.equal(logic.isListingHubUrl(withId), false);
  assert.equal(logic.isSpecificOpportunityUrl(withId, logic.OPPORTUNITY_TYPES.JOB), true);
});

test('unique keys differ for different facebook posts', () => {
  const a = logic.makeUniqueKey('Eden', 'PPC freelancer', FB_MARKETING);
  const b = logic.makeUniqueKey('Eden', 'PPC freelancer', FB_AI);
  assert.notEqual(a, b);
  assert.match(a, /3087091901496316/);
});

test('content identity dedupes same URL with tracking noise', () => {
  const first = logic.makeContentIdentity('Acme', 'Growth Lead', FB_MARKETING, 'facebook_public');
  const second = logic.makeContentIdentity(
    'Acme',
    'Growth Lead',
    'https://www.facebook.com/groups/superface.marketing.digital/permalink/3087091901496316',
    'facebook_public'
  );
  assert.equal(first, second);
});

test('classification prefers explicit type then freelance hints', () => {
  assert.equal(
    logic.classifyOpportunityType({ opportunity_type: 'Job', notes: 'freelance please' }),
    'Job'
  );
  assert.equal(
    logic.classifyOpportunityType({ role: 'Landing page build', notes: 'דרוש פרילנסר ל-PPC' }),
    'Freelance'
  );
  assert.equal(
    logic.classifyOpportunityType({ role: 'AI Solutions Engineer', notes: 'Full-time Tel Aviv' }),
    'Job'
  );
});

test('age filter keeps exceptional old matches and drops weak old matches', () => {
  const now = new Date('2026-08-05T12:00:00Z');
  assert.equal(logic.shouldAcceptByAgeAndScore('2026-07-01', 95, 14, now), true);
  assert.equal(logic.shouldAcceptByAgeAndScore('2026-07-01', 80, 14, now), false);
  assert.equal(logic.shouldAcceptByAgeAndScore('2026-08-04', 75, 14, now), true);
  assert.equal(logic.shouldAcceptByAgeAndScore('', 75, 14, now), true);
});

test('freelance field mapping uses author/budget/post_url fallbacks', () => {
  const mapped = logic.mapFreelanceFields({
    author: 'Gal Peri',
    requested_work: 'Meta ads audit',
    budget: '1500 ILS',
    post_url: FB_MARKETING,
    contact_instructions: 'Comment or DM',
  });
  assert.equal(mapped.company, 'Gal Peri');
  assert.equal(mapped.role, 'Meta ads audit');
  assert.equal(mapped.salary, '1500 ILS');
  assert.equal(mapped.job_url, FB_MARKETING);
  assert.equal(mapped.notes, 'Comment or DM');
});

test('rows without role, company or URL are not opportunities', () => {
  assert.equal(logic.isOpportunityRow({ role: '', company: '', jobUrl: '' }), false);
  assert.equal(logic.isOpportunityRow({}), false);
  assert.equal(logic.isOpportunityRow({ role: '   ' }), false);
  assert.equal(logic.isOpportunityRow({ company: 'Private client' }), true);
  assert.equal(logic.isOpportunityRow({ jobUrl: FB_MARKETING }), true);
});

test('company+role alone is not enough for content identity when URLs differ', () => {
  const a = logic.makeContentIdentity('Torq', 'AI Solutions Engineer', GREENHOUSE, 'greenhouse');
  const b = logic.makeContentIdentity(
    'Torq',
    'AI Solutions Engineer',
    'https://job-boards.greenhouse.io/torq/jobs/6119299004',
    'greenhouse'
  );
  assert.notEqual(a, b);
});

test('content identity without URL uses company role and location', () => {
  const a = logic.makeContentIdentity('Acme', 'PPC Lead', '', 'mploy', 'Tel Aviv');
  const b = logic.makeContentIdentity('Acme', 'PPC Lead', '', 'mploy', 'Haifa');
  assert.notEqual(a, b);
});

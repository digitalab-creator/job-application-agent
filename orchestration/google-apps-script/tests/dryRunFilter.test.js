const test = require('node:test');
const assert = require('node:assert/strict');
const logic = require('../lib/opportunityLogic');

/**
 * Local stand-in for processCandidates_ filtering decisions.
 * Keeps dry-run verification possible without Apps Script runtime.
 */
function filterCandidate(candidate, existing, settings) {
  const reasons = [];
  const opportunityType = logic.classifyOpportunityType(candidate);
  if (!candidate.role || !candidate.company || !candidate.job_url) reasons.push('missing_required_fields');
  if ((candidate.match_score || 0) < settings.minMatchScore) reasons.push('below_min_score');
  if (!logic.shouldAcceptByAgeAndScore(candidate.posted_date, candidate.match_score || 0, settings.maxAgeDays, settings.now)) {
    reasons.push('too_old');
  }
  if (!logic.isSpecificOpportunityUrl(candidate.job_url, opportunityType)) reasons.push('generic_url');

  const uniqueKey = logic.makeUniqueKey(candidate.company, candidate.role, candidate.job_url);
  const normalizedUrl = logic.normalizeUrl(candidate.job_url);
  const contentId = logic.makeContentIdentity(
    candidate.company,
    candidate.role,
    candidate.job_url,
    candidate.source_type || 'web'
  );

  if (existing.keys.has(uniqueKey) || existing.urls.has(normalizedUrl) || existing.contentIds.has(contentId)) {
    reasons.push('duplicate');
  }

  if (reasons.length) return { accepted: false, reasons, opportunityType };

  existing.keys.add(uniqueKey);
  existing.urls.add(normalizedUrl);
  existing.contentIds.add(contentId);
  return { accepted: true, reasons: [], opportunityType, uniqueKey };
}

test('dry-run style filter routes facebook freelance and rejects group roots', () => {
  const existing = { keys: new Set(), urls: new Set(), contentIds: new Set() };
  const settings = {
    minMatchScore: 70,
    maxAgeDays: 14,
    now: new Date('2026-08-05T12:00:00Z'),
  };

  const goodFreelance = filterCandidate({
    role: 'Meta ads setup',
    company: 'Eden Bachar',
    job_url: 'https://www.facebook.com/groups/superface.marketing.digital/permalink/3087091901496316/',
    match_score: 88,
    posted_date: '2026-08-02',
    notes: 'מחפש פרילנסר',
    source_type: 'facebook_public',
  }, existing, settings);

  assert.equal(goodFreelance.accepted, true);
  assert.equal(goodFreelance.opportunityType, 'Freelance');

  const groupRoot = filterCandidate({
    role: 'Growth hire',
    company: 'Unknown',
    job_url: 'https://www.facebook.com/groups/superface.marketing.digital/',
    match_score: 90,
    posted_date: '2026-08-04',
    opportunity_type: 'Job',
  }, existing, settings);

  assert.equal(groupRoot.accepted, false);
  assert.ok(groupRoot.reasons.includes('generic_url'));

  const dup = filterCandidate({
    role: 'Meta ads setup',
    company: 'Eden Bachar',
    job_url: 'https://www.facebook.com/groups/superface.marketing.digital/permalink/3087091901496316/?rdid=abc',
    match_score: 91,
    posted_date: '2026-08-02',
    notes: 'freelance',
    source_type: 'facebook_public',
  }, existing, settings);

  assert.equal(dup.accepted, false);
  assert.ok(dup.reasons.includes('duplicate'));
});

test('same company+role with different ATS urls both can pass', () => {
  const existing = { keys: new Set(), urls: new Set(), contentIds: new Set() };
  const settings = {
    minMatchScore: 70,
    maxAgeDays: 14,
    now: new Date('2026-08-05T12:00:00Z'),
  };

  const first = filterCandidate({
    role: 'AI Solutions Engineer',
    company: 'Torq',
    job_url: 'https://job-boards.greenhouse.io/torq/jobs/6119299004',
    match_score: 84,
    posted_date: '2026-08-04',
    opportunity_type: 'Job',
    source_type: 'greenhouse',
  }, existing, settings);

  const second = filterCandidate({
    role: 'AI Solutions Engineer',
    company: 'Torq',
    job_url: 'https://job-boards.greenhouse.io/torq/jobs/9999999999',
    match_score: 84,
    posted_date: '2026-08-04',
    opportunity_type: 'Job',
    source_type: 'greenhouse',
  }, existing, settings);

  assert.equal(first.accepted, true);
  assert.equal(second.accepted, true);
});

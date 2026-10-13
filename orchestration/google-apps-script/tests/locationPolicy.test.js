const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppsScript } = require('./helpers/loadAppsScript');

const api = loadAppsScript(
  ['Config.js', 'Utils.js', 'LocationPolicy.js', 'SourcesCatalog.js', 'SourceProviders.js'],
  ['evaluateLocationPolicy_', 'isIsraelScopedSource_', 'israelGeoQueryClause_', 'buildSourceDiscoveryPlan_']
);

function verdict(candidate) {
  return api.evaluateLocationPolicy_(candidate);
}

test('remote roles restricted away from Israel are rejected', () => {
  const usOnly = verdict({
    role: 'Senior Growth Manager',
    work_mode: 'Remote',
    location: 'Remote (United States)',
    notes: '',
  });
  assert.equal(usOnly.ok, false);

  const restrictionSentence = verdict({
    work_mode: 'Fully remote',
    location: 'Remote',
    notes: 'Candidates must be authorized to work in the United States.',
  });
  assert.equal(restrictionSentence.ok, false);
  assert.equal(restrictionSentence.reason, 'remote_not_israel_eligible');

  const declaredByModel = verdict({
    work_mode: 'Remote',
    location: 'Remote',
    geo_eligibility: 'restricted_excludes_israel',
    notes: '',
  });
  assert.equal(declaredByModel.ok, false);

  const euOnly = verdict({
    work_mode: 'Remote',
    location: 'Remote - Europe',
    notes: 'EU residents only.',
  });
  assert.equal(euOnly.ok, false);
});

test('remote roles open to Israel are kept', () => {
  const explicitIsrael = verdict({
    work_mode: 'Remote',
    location: 'Remote, Israel',
    notes: '',
  });
  assert.equal(explicitIsrael.ok, true);

  const worldwide = verdict({
    work_mode: 'Remote',
    location: 'Remote - Worldwide',
    notes: '',
  });
  assert.equal(worldwide.ok, true);

  const emea = verdict({
    work_mode: 'Remote',
    location: 'Remote (EMEA)',
    notes: 'Hiring across EMEA.',
  });
  assert.equal(emea.ok, true);

  // Israel signal must outrank a foreign country name on the same posting.
  const israeliRoleAtUsCompany = verdict({
    work_mode: 'Remote',
    location: 'Israel',
    notes: 'US-headquartered company hiring in Israel.',
    why_it_fits: 'Remote role for an Israel-based candidate.',
  });
  assert.equal(israeliRoleAtUsCompany.ok, true);

  const israeliCityRestriction = verdict({
    work_mode: 'Remote',
    location: 'Remote',
    notes: 'Candidates must be based in Tel Aviv.',
  });
  assert.equal(israeliCityRestriction.ok, true);

  const unknownStaysIn = verdict({
    work_mode: 'Remote',
    location: 'Remote',
    notes: '',
  });
  assert.equal(unknownStaysIn.ok, true);
  assert.equal(unknownStaysIn.reason, 'remote_eligibility_unknown');
});

test('a remote role with no stated restriction is kept, even near foreign mentions', () => {
  // The page was read and states no limit: absence of a restriction is not a restriction.
  const noRestrictionStated = verdict({
    work_mode: 'Remote',
    location: 'Remote (United States)',
    geo_eligibility: 'no_restriction_stated',
    notes: 'Listing states no location or work-authorization requirement.',
  });
  assert.equal(noRestrictionStated.ok, true);

  // A US parent company mentioned in prose must not sink an unrestricted remote role.
  const usCompanyInProse = verdict({
    work_mode: 'Remote',
    location: 'Remote',
    notes: 'Series B company headquartered in the United States.',
    why_it_fits: 'Growth role at a US startup, fully distributed team.',
  });
  assert.equal(usCompanyInProse.ok, true);

  // But a country restriction in the location field is still a restriction.
  const foreignLocationField = verdict({
    work_mode: 'Remote',
    location: 'Remote - Canada',
    notes: '',
  });
  assert.equal(foreignLocationField.ok, false);
  assert.equal(foreignLocationField.reason, 'remote_foreign_market');
});

test('commute policy still applies to hybrid and on-site roles', () => {
  assert.equal(verdict({ work_mode: 'Hybrid', location: 'Tel Aviv' }).ok, true);
  assert.equal(verdict({ work_mode: 'On-site', location: 'Haifa' }).ok, false);
  assert.equal(verdict({ work_mode: 'Hybrid', location: 'Berlin, Germany' }).ok, false);
});

test('only global sources get an Israel clause added to discovery queries', () => {
  assert.equal(api.isIsraelScopedSource_({ source_id: 'il_drushim', query_or_url: 'https://www.drushim.co.il/' }), true);
  assert.equal(api.isIsraelScopedSource_({ source_id: 'fb_ai_il', query_or_url: 'https://facebook.com/groups/x' }), true);
  assert.equal(api.isIsraelScopedSource_({ source_id: 'web_ats_lever', query_or_url: 'jobs.lever.co' }), false);

  assert.equal(api.israelGeoQueryClause_({ source_id: 'il_drushim', query_or_url: 'https://www.drushim.co.il/' }), '');

  const globalSource = {
    source_id: 'web_ats_lever',
    query_or_url: 'jobs.lever.co',
    opportunity_types: 'Job',
    type: 'web_jobs',
    label: 'Lever ATS',
  };
  const plan = api.buildSourceDiscoveryPlan_(globalSource, [
    { category: 'Applied AI', titles: ['AI Engineer', 'Growth Lead'] },
  ]);
  assert.ok(plan.includes('site:jobs.lever.co'));
  assert.ok(plan.includes('Israel'));
});

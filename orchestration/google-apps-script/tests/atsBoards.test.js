const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppsScript } = require('./helpers/loadAppsScript');

let responses = [];

const api = loadAppsScript(
  ['Config.js', 'Utils.js', 'LocationPolicy.js', 'AtsRoster.js', 'AtsBoards.js'],
  [
    'ATS_PROVIDERS',
    'ATS_COMPANIES',
    'fetchAtsBoards_',
    'filterAtsRoles_',
    'isIsraeliAtsLocation_',
    'buildAtsTitlePattern_',
    'atsDate_',
  ],
  {
    SpreadsheetApp: {},
    Utilities: {
      formatDate: (d) => d.toISOString().slice(0, 10),
    },
    UrlFetchApp: {
      fetchAll: () => responses.map((r) => ({
        getResponseCode: () => r.code,
        getContentText: () => r.body,
      })),
    },
  }
);

const CATEGORIES = [
  { category: 'Growth Marketing', titles: ['PPC Manager', 'Growth Lead'] },
  { category: 'Applied AI', titles: ['AI Engineer'] },
];

test('each provider maps its own payload shape onto the shared role shape', () => {
  const greenhouse = Array.from(api.ATS_PROVIDERS.greenhouse.extract({
    jobs: [{
      id: 7556263,
      title: 'AI Engineer',
      location: { name: 'Tel Aviv-Yafo' },
      absolute_url: 'https://job-boards.greenhouse.io/similarweb/jobs/7556263',
      first_published: '2026-01-22T04:51:31-05:00',
    }],
  }));
  assert.deepEqual(Object.assign({}, greenhouse[0]), {
    id: '7556263',
    title: 'AI Engineer',
    location: 'Tel Aviv-Yafo',
    url: 'https://job-boards.greenhouse.io/similarweb/jobs/7556263',
    posted: '2026-01-22',
  });

  const lever = Array.from(api.ATS_PROVIDERS.lever.extract([{
    id: 'abc-123',
    text: 'Growth Lead',
    categories: { location: 'Tel Aviv' },
    hostedUrl: 'https://jobs.lever.co/acme/abc-123',
    createdAt: 1767225600000,
  }]));
  assert.equal(lever[0].title, 'Growth Lead');
  assert.equal(lever[0].url, 'https://jobs.lever.co/acme/abc-123');
  assert.match(lever[0].posted, /^\d{4}-\d{2}-\d{2}$/);

  const ashby = Array.from(api.ATS_PROVIDERS.ashby.extract({
    jobs: [{
      id: 'x1',
      title: 'PPC Manager',
      location: 'Herzliya',
      jobUrl: 'https://jobs.ashbyhq.com/acme/x1',
      publishedAt: '2026-08-01T00:00:00Z',
    }],
  }));
  assert.equal(ashby[0].location, 'Herzliya');
  assert.equal(ashby[0].posted, '2026-08-01');
});

test('a provider handed an unexpected payload yields no roles instead of throwing', () => {
  assert.equal(Array.from(api.ATS_PROVIDERS.greenhouse.extract({})).length, 0);
  assert.equal(Array.from(api.ATS_PROVIDERS.lever.extract(null)).length, 0);
  assert.equal(Array.from(api.ATS_PROVIDERS.ashby.extract({ jobs: 'nope' })).length, 0);
});

test('Israeli office locations are kept and far or foreign ones dropped', () => {
  ['Tel Aviv-Yafo', 'Herzliya', 'Ramat Gan', 'Israel', 'Petah Tikva'].forEach((place) => {
    assert.equal(api.isIsraeliAtsLocation_(place), true, `${place} should be kept`);
  });
  ['New York', 'London', 'Haifa', "Be'er Sheva", 'Bangalore', ''].forEach((place) => {
    assert.equal(api.isIsraeliAtsLocation_(place), false, `${place} should be dropped`);
  });
});

test('title matching is word-bounded, so a fragment cannot pass as a match', () => {
  const pattern = api.buildAtsTitlePattern_(CATEGORIES);
  assert.ok(pattern.test('Senior AI Engineer'));
  assert.ok(pattern.test('Growth Marketing Manager'));
  assert.ok(!pattern.test('Air Traffic Controller'), '"ai" must not match inside "Air"');
  assert.ok(!pattern.test('Warehouse Picker'));
});

test('with no configured titles nothing is filtered out on title', () => {
  assert.equal(api.buildAtsTitlePattern_([]), null);
});

test('filtering drops non-Israel and off-profile roles, dedupes, and sorts newest first', () => {
  const roles = [
    { url: 'https://b.co/1', title: 'AI Engineer', location: 'Tel Aviv', posted: '2026-08-01', company: 'A' },
    { url: 'https://b.co/2', title: 'AI Engineer', location: 'New York', posted: '2026-08-05', company: 'A' },
    { url: 'https://b.co/3', title: 'Chef', location: 'Tel Aviv', posted: '2026-08-06', company: 'A' },
    { url: 'https://b.co/4', title: 'PPC Manager', location: 'Herzliya', posted: '2026-08-07', company: 'B' },
    { url: 'https://b.co/1', title: 'AI Engineer', location: 'Tel Aviv', posted: '2026-08-01', company: 'A' },
  ];

  const kept = Array.from(api.filterAtsRoles_(roles, CATEGORIES));
  assert.deepEqual(kept.map((r) => r.url), ['https://b.co/4', 'https://b.co/1']);
});

test('one dead board does not stop the others being read', () => {
  const companies = [
    { slug: 'good', provider: 'greenhouse', label: 'Good Co' },
    { slug: 'gone', provider: 'greenhouse', label: 'Gone Co' },
  ];
  responses = [
    {
      code: 200,
      body: JSON.stringify({
        jobs: [{
          id: 1,
          title: 'AI Engineer',
          location: { name: 'Tel Aviv' },
          absolute_url: 'https://job-boards.greenhouse.io/good/jobs/1',
        }],
      }),
    },
    { code: 404, body: 'not found' },
  ];

  const result = api.fetchAtsBoards_(companies);
  assert.equal(result.okBoards, 1);
  assert.equal(result.failedBoards, 1);
  assert.equal(result.roles.length, 1);
  assert.equal(result.roles[0].company, 'Good Co');
  assert.match(result.notes, /Gone Co/);
});

test('malformed JSON from a board is contained to that board', () => {
  const companies = [{ slug: 'broken', provider: 'greenhouse', label: 'Broken Co' }];
  responses = [{ code: 200, body: '{"jobs": [' }];

  const result = api.fetchAtsBoards_(companies);
  assert.equal(result.okBoards, 0);
  assert.equal(result.roles.length, 0);
});

test('roles without a usable title or absolute URL are discarded', () => {
  const companies = [{ slug: 'x', provider: 'greenhouse', label: 'X' }];
  responses = [{
    code: 200,
    body: JSON.stringify({
      jobs: [
        { id: 1, title: '', location: { name: 'Tel Aviv' }, absolute_url: 'https://x.co/1' },
        { id: 2, title: 'AI Engineer', location: { name: 'Tel Aviv' }, absolute_url: '/relative' },
        { id: 3, title: 'AI Engineer', location: { name: 'Tel Aviv' }, absolute_url: 'https://x.co/3' },
      ],
    }),
  }];

  const result = api.fetchAtsBoards_(companies);
  assert.equal(result.roles.length, 1);
  assert.equal(result.roles[0].url, 'https://x.co/3');
});

test('every rostered company names a provider that exists', () => {
  Array.from(api.ATS_COMPANIES).forEach((company) => {
    assert.ok(api.ATS_PROVIDERS[company.provider], `${company.slug} uses unknown ATS ${company.provider}`);
    assert.ok(company.label, `${company.slug} needs a display label`);
    assert.match(api.ATS_PROVIDERS[company.provider].endpoint(company.slug), /^https:\/\//);
  });
});

test('a missing or unparseable date yields an empty string, not a wrong one', () => {
  assert.equal(api.atsDate_(null), '');
  assert.equal(api.atsDate_('sometime'), '');
  assert.equal(api.atsDate_('2026-08-07T10:00:00Z'), '2026-08-07');
});

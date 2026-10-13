const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppsScript } = require('./helpers/loadAppsScript');

const JOB_PAGE = '<html><head><title>Senior Growth Manager - Acme</title></head><body>Apply now for this role.</body></html>';

const routes = new Map();
const throwers = new Map();
const state = { fetchAllThrows: false, fetchAllBatches: [], singleFetches: [] };

function makeResponse(code, body, headers) {
  return {
    getResponseCode: () => code,
    getContentText: () => body || '',
    getAllHeaders: () => headers || {},
  };
}

function route(url) {
  if (throwers.has(url)) throw new Error(throwers.get(url));
  return routes.has(url) ? routes.get(url) : makeResponse(200, JOB_PAGE);
}

// The sandbox returns arrays from its own realm, which deepStrictEqual rejects on
// prototype identity, so rebuild the list here before comparing.
function closedFlags(verdicts) {
  return Array.from(verdicts, (verdict) => verdict.definitelyClosed);
}

const UrlFetchApp = {
  fetchAll(requests) {
    state.fetchAllBatches.push(requests.map((request) => request.url));
    if (state.fetchAllThrows) throw new Error('one bad host sank the batch');
    return requests.map((request) => route(request.url));
  },
  fetch(url) {
    state.singleFetches.push(url);
    return route(url);
  },
};

const api = loadAppsScript(
  ['Config.js', 'Utils.js', 'UrlInspector.js', 'LinkLiveness.js'],
  [
    'inspectJobUrl_',
    'inspectJobUrls_',
    'isHubOrRootUrl_',
    'resolveRedirectUrl_',
    'extractStrongJobId_',
    'isNotFoundTitle_',
  ],
  { UrlFetchApp }
);

test.beforeEach(() => {
  routes.clear();
  throwers.clear();
  state.fetchAllThrows = false;
  state.fetchAllBatches = [];
  state.singleFetches = [];
});

// Observed live: careers.varos.com has no DNS record at all, so the fetch throws
// before any HTTP status exists. That used to read as "inconclusive" and the row
// stayed Active forever.
test('a hostname that no longer resolves closes the posting', () => {
  throwers.set(
    'https://careers.varos.com/jobs/head-of-growth',
    'DNS error: https://careers.varos.com/jobs/head-of-growth'
  );

  const verdict = api.inspectJobUrl_('https://careers.varos.com/jobs/head-of-growth');
  assert.equal(verdict.definitelyClosed, true);
  assert.match(verdict.reason, /Host no longer exists/);
});

test('a transient failure is flagged unreachable, never closed outright', () => {
  throwers.set('https://acme.com/job/300001', 'Timeout: https://acme.com/job/300001');

  const verdict = api.inspectJobUrl_('https://acme.com/job/300001');
  assert.equal(verdict.definitelyClosed, false);
  assert.equal(verdict.unreachable, true);
});

test('a dead host is detected even when it sinks a parallel batch', () => {
  throwers.set('https://careers.varos.com/jobs/head-of-growth', 'DNS error: careers.varos.com');
  routes.set('https://acme.com/job/310002', makeResponse(200, JOB_PAGE));

  const verdicts = api.inspectJobUrls_([
    'https://careers.varos.com/jobs/head-of-growth',
    'https://acme.com/job/310002',
  ]);

  assert.deepEqual(closedFlags(verdicts), [true, false]);
});

test('a healthy check reports no unreachable flag', () => {
  assert.equal(Boolean(api.inspectJobUrl_('https://acme.com/job/320001').unreachable), false);
});

test('a hard 404 or 410 closes the posting', () => {
  routes.set('https://acme.com/job/99999', makeResponse(404, 'Not found'));
  routes.set('https://acme.com/job/88888', makeResponse(410, 'Gone'));

  assert.equal(api.inspectJobUrl_('https://acme.com/job/99999').definitelyClosed, true);
  assert.equal(api.inspectJobUrl_('https://acme.com/job/88888').definitelyClosed, true);
});

test('a redirect to the careers hub closes the posting even though it answers 200', () => {
  routes.set(
    'https://acme.com/job/123456',
    makeResponse(301, '', { Location: 'https://acme.com/careers' })
  );
  routes.set('https://acme.com/careers', makeResponse(200, JOB_PAGE));

  const verdict = api.inspectJobUrl_('https://acme.com/job/123456');
  assert.equal(verdict.definitelyClosed, true);
  assert.match(verdict.reason, /hub or site root/);
});

test('a redirect to the site root closes the posting', () => {
  routes.set(
    'https://acme.com/positions/senior-ppc-manager',
    makeResponse(302, '', { location: 'https://acme.com/' })
  );

  assert.equal(api.inspectJobUrl_('https://acme.com/positions/senior-ppc-manager').definitelyClosed, true);
});

test('a redirect that loses the posting id closes the posting', () => {
  routes.set(
    'https://boards.greenhouse.io/acme/jobs/4931573101',
    makeResponse(302, '', { Location: 'https://job-boards.greenhouse.io/acme/jobs/7777777777' })
  );

  const verdict = api.inspectJobUrl_('https://boards.greenhouse.io/acme/jobs/4931573101');
  assert.equal(verdict.definitelyClosed, true);
  assert.match(verdict.reason, /4931573101/);
});

test('a canonical redirect that keeps the posting id stays open', () => {
  routes.set(
    'https://boards.greenhouse.io/acme/jobs/4931573101',
    makeResponse(301, '', { Location: 'https://job-boards.greenhouse.io/acme/jobs/4931573101?gh_src=x' })
  );

  assert.equal(api.inspectJobUrl_('https://boards.greenhouse.io/acme/jobs/4931573101').definitelyClosed, false);
});

// Observed live: Greenhouse answers a removed posting with 301 -> board root
// carrying ?error=true, which then serves a normal HTTP 200 page.
test('a redirect to a board error page closes the posting', () => {
  routes.set(
    'https://job-boards.greenhouse.io/unframe/jobs/4931573101',
    makeResponse(301, '', { Location: 'https://job-boards.greenhouse.io/unframe?error=true' })
  );
  routes.set('https://job-boards.greenhouse.io/unframe?error=true', makeResponse(200, JOB_PAGE));

  assert.equal(api.inspectJobUrl_('https://job-boards.greenhouse.io/unframe/jobs/4931573101').definitelyClosed, true);

  // Same board, slug-style posting with no strong id: the error flag must still catch it.
  routes.set(
    'https://job-boards.greenhouse.io/unframe/jobs/growth-lead',
    makeResponse(301, '', { Location: 'https://job-boards.greenhouse.io/unframe?error=true' })
  );
  const slugVerdict = api.inspectJobUrl_('https://job-boards.greenhouse.io/unframe/jobs/growth-lead');
  assert.equal(slugVerdict.definitelyClosed, true);
  assert.match(slugVerdict.reason, /error page/);
});

test('relative and protocol-relative redirect targets resolve against the base URL', () => {
  assert.equal(
    api.resolveRedirectUrl_('/careers', 'https://acme.com/job/123456'),
    'https://acme.com/careers'
  );
  assert.equal(
    api.resolveRedirectUrl_('456789', 'https://acme.com/job/123456'),
    'https://acme.com/job/456789'
  );
  assert.equal(
    api.resolveRedirectUrl_('//cdn.acme.com/job/123456', 'https://acme.com/job/123456'),
    'https://cdn.acme.com/job/123456'
  );
});

test('a redirect chain is followed to its landing page', () => {
  routes.set('https://acme.com/j/1', makeResponse(301, '', { Location: '/j/2' }));
  routes.set('https://acme.com/j/2', makeResponse(302, '', { Location: '/jobs' }));

  assert.equal(api.inspectJobUrl_('https://acme.com/j/1').definitelyClosed, true);
});

test('an endless redirect loop is inconclusive rather than closed', () => {
  routes.set('https://acme.com/loop', makeResponse(302, '', { Location: 'https://acme.com/loop' }));

  const verdict = api.inspectJobUrl_('https://acme.com/loop');
  assert.equal(verdict.definitelyClosed, false);
  assert.match(verdict.reason, /redirect chain did not resolve/);
});

test('explicit closed wording closes the posting, in English and Hebrew', () => {
  routes.set('https://acme.com/job/111111', makeResponse(200, 'This position has been filled.'));
  routes.set('https://acme.com/job/222222', makeResponse(200, 'המשרה אוישה, תודה על ההתעניינות'));
  routes.set('https://acme.com/job/333333', makeResponse(200, 'This listing is no longer available.'));

  assert.equal(api.inspectJobUrl_('https://acme.com/job/111111').definitelyClosed, true);
  assert.equal(api.inspectJobUrl_('https://acme.com/job/222222').definitelyClosed, true);
  assert.equal(api.inspectJobUrl_('https://acme.com/job/333333').definitelyClosed, true);
});

test('a soft 404 is caught by the page title', () => {
  routes.set(
    'https://acme.com/job/444444',
    makeResponse(200, '<html><head><title>404 - Page Not Found</title></head><body>Try our search.</body></html>')
  );

  const verdict = api.inspectJobUrl_('https://acme.com/job/444444');
  assert.equal(verdict.definitelyClosed, true);
  assert.match(verdict.reason, /soft 404/);
});

test('a healthy posting stays open and common careers copy is not a false positive', () => {
  routes.set('https://acme.com/job/555555', makeResponse(200, JOB_PAGE));
  routes.set(
    'https://acme.com/job/666666',
    makeResponse(200, "<html><head><title>Growth Lead</title></head><body>Can't find the job you're looking for? Send us your CV.</body></html>")
  );

  assert.equal(api.inspectJobUrl_('https://acme.com/job/555555').definitelyClosed, false);
  assert.equal(api.inspectJobUrl_('https://acme.com/job/666666').definitelyClosed, false);
});

test('a login wall is inconclusive, never closed', () => {
  routes.set('https://acme.com/job/777777', makeResponse(403, 'Forbidden'));

  const verdict = api.inspectJobUrl_('https://acme.com/job/777777');
  assert.equal(verdict.definitelyClosed, false);
  assert.equal(verdict.accessible, false);
});

test('a batch of URLs is checked in one parallel round and keeps input order', () => {
  routes.set('https://acme.com/job/100001', makeResponse(404, 'Not found'));
  routes.set('https://acme.com/job/100003', makeResponse(200, 'This position is closed'));

  const verdicts = api.inspectJobUrls_([
    'https://acme.com/job/100001',
    'https://acme.com/job/100002',
    'https://acme.com/job/100003',
  ]);

  assert.deepEqual(closedFlags(verdicts), [true, false, true]);
  assert.equal(state.fetchAllBatches.length, 1);
  assert.equal(state.fetchAllBatches[0].length, 3);
});

test('one bad host does not sink the whole batch', () => {
  state.fetchAllThrows = true;
  routes.set('https://acme.com/job/200001', makeResponse(404, 'Not found'));

  const verdicts = api.inspectJobUrls_([
    'https://acme.com/job/200001',
    'https://acme.com/job/200002',
  ]);

  assert.deepEqual(closedFlags(verdicts), [true, false]);
  assert.equal(state.singleFetches.length, 2);
});

test('hub detection separates list pages from real postings', () => {
  assert.equal(api.isHubOrRootUrl_('https://acme.com/'), true);
  assert.equal(api.isHubOrRootUrl_('https://acme.com'), true);
  assert.equal(api.isHubOrRootUrl_('https://acme.com/careers'), true);
  assert.equal(api.isHubOrRootUrl_('https://acme.com/en/careers/'), true);
  assert.equal(api.isHubOrRootUrl_('https://acme.com/jobs?dept=growth'), true);
  assert.equal(api.isHubOrRootUrl_('https://acme.com/he'), true);
  assert.equal(api.isHubOrRootUrl_('https://acme.com/404'), true);

  assert.equal(api.isHubOrRootUrl_('https://acme.com/careers/senior-ppc-manager'), false);
  assert.equal(api.isHubOrRootUrl_('https://boards.greenhouse.io/acme/jobs/4931573101'), false);
  assert.equal(api.isHubOrRootUrl_('https://www.janglo.net/item/1234567'), false);
});

test('only strong posting ids drive the redirect check, so slug renames survive', () => {
  assert.equal(api.extractStrongJobId_('https://boards.greenhouse.io/acme/jobs/4931573101'), '4931573101');
  assert.equal(api.extractStrongJobId_('https://acme.com/apply?jobId=ABC-77'), 'ABC-77');
  assert.equal(api.extractStrongJobId_('https://acme.com/careers/senior-ppc-manager'), '');

  routes.set(
    'https://acme.com/careers/senior-ppc-manager',
    makeResponse(301, '', { Location: 'https://acme.com/careers/senior-performance-marketing-manager' })
  );
  assert.equal(api.inspectJobUrl_('https://acme.com/careers/senior-ppc-manager').definitelyClosed, false);
});

test('title check ignores healthy job pages', () => {
  assert.equal(api.isNotFoundTitle_(JOB_PAGE), false);
  assert.equal(api.isNotFoundTitle_('<title>Page Not Found</title>'), true);
});

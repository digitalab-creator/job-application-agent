/**
 * Pure opportunity helpers shared with Node tests.
 * Keep behavior aligned with Apps Script UrlInspector + FacebookSearch + Utils.
 */
const OPPORTUNITY_TYPES = Object.freeze({
  JOB: 'Job',
  FREELANCE: 'Freelance',
});

function cleanString(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function slug(value) {
  return cleanString(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

function getDomain(url) {
  const match = cleanString(url).match(/^https?:\/\/([^/]+)/i);
  return match ? match[1].replace(/^www\./i, '') : 'unknown-source';
}

function normalizeUrl(url) {
  let value = cleanString(url).replace(/#.*$/, '');
  value = value.replace(/([?&])(utm_[^=]+|trk|trackingId|refId|source|src|rdid)=[^&]*/gi, '$1');
  value = value.replace(/[?&]+$/, '').replace(/\?&/, '?').replace(/&&+/g, '&');
  return value.replace(/\/+$/, '').toLowerCase();
}

function extractJobId(url) {
  const value = cleanString(url);
  const facebookPermalink = value.match(/\/permalink\/(\d+)/i) || value.match(/[?&]story_fbid=(\d+)/i);
  if (facebookPermalink) return facebookPermalink[1];

  const queryMatch = value.match(/[?&](?:jobid|job_id|gh_jid|lever-origin|position|id)=([^&#]+)/i);
  if (queryMatch) return decodeURIComponent(queryMatch[1]);

  const uuidMatch = value.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i);
  if (uuidMatch) return uuidMatch[0];

  const numericMatches = value.match(/\d{5,}/g);
  if (numericMatches && numericMatches.length) return numericMatches[numericMatches.length - 1];

  const path = value.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/');
  return path[path.length - 1] || '';
}

function makeUniqueKey(company, role, url) {
  const id = extractJobId(url) || getDomain(url);
  return `${slug(company)}|${slug(role)}|${slug(id)}`.toLowerCase();
}

function makeContentIdentity(company, role, url, sourceType, location) {
  const normalized = normalizeUrl(url);
  if (normalized) return `url:${normalized}`;
  return `content:${slug(sourceType)}|${slug(company)}|${slug(role)}|${slug(location || '')}`;
}

const HUB_TAIL_PATTERN = new RegExp(
  '/(?:careers?|jobs?|job-search|job_search|positions?|openings?|opportunities'
  + '|vacancy|vacancies|join-us|work-with-us|search|browse|listings?)$',
  'i'
);

const LISTING_TAXONOMY_PATTERN = new RegExp(
  '/(?:categor(?:y|ies)|industr(?:y|ies)|sectors?|professions?|fields?'
  + '|tags?|topics?|disciplines?|specializations?)(?:/|$)',
  'i'
);

function urlPath(url) {
  const match = cleanString(url).match(/^https?:\/\/[^/]+(\/[^?#]*)?/i);
  return match && match[1] ? match[1] : '/';
}

function extractStrongJobId(url) {
  const value = cleanString(url);
  const queryMatch = value.match(/[?&](?:jobid|job_id|gh_jid|requisitionid|reqid|position|id)=([^&#]+)/i);
  if (queryMatch) return decodeURIComponent(queryMatch[1]);

  const uuidMatch = value.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i);
  if (uuidMatch) return uuidMatch[0];

  const numericMatches = value.replace(/[?#].*$/, '').match(/\d{5,}/g);
  if (numericMatches && numericMatches.length) return numericMatches[numericMatches.length - 1];

  return '';
}

function isListingHubUrl(url) {
  const path = urlPath(url).replace(/\/+$/, '');
  if (!path) return true;
  if (HUB_TAIL_PATTERN.test(path)) return true;
  return LISTING_TAXONOMY_PATTERN.test(path) && !extractStrongJobId(url);
}

function isSpecificOpportunityUrl(url, opportunityType) {
  const value = cleanString(url);
  if (!/^https?:\/\//i.test(value)) return false;

  const genericPatterns = [
    /linkedin\.com\/jobs\/search/i,
    /indeed\.[^/]+\/(?:jobs|q-)/i,
    /alljobs\.co\.il\/SearchResults/i,
    /google\.[^/]+\/search/i,
    /facebook\.com\/groups\/[^/]+\/?$/i,
    /facebook\.com\/groups\/[^/]+\/?\?.*$/i,
    /facebook\.com\/search/i,
  ];

  if (genericPatterns.some((pattern) => pattern.test(value))) return false;
  if (isListingHubUrl(value)) return false;

  if (opportunityType === OPPORTUNITY_TYPES.FREELANCE) {
    if (/facebook\.com\/(?:groups\/[^/]+\/permalink\/\d+|[^/]+\/posts\/\d+|permalink\.php)/i.test(value)) {
      return true;
    }
  }

  return true;
}

function classifyOpportunityType(candidate) {
  const explicit = cleanString(candidate.opportunity_type);
  if (explicit === OPPORTUNITY_TYPES.JOB || explicit === OPPORTUNITY_TYPES.FREELANCE) {
    return explicit;
  }

  const blob = [
    candidate.role,
    candidate.notes,
    candidate.why_it_fits,
    candidate.source,
    candidate.work_mode,
  ].map(cleanString).join(' ').toLowerCase();

  const freelanceHints = [
    'freelance',
    'freelancer',
    'פרילנס',
    'עצמאי',
    'פרויקט',
    'project based',
    'contract',
    'consulting',
    'hourly',
    'retainer',
    'מחפש פרילנסר',
    'דרוש פרילנסר',
  ];

  if (freelanceHints.some((hint) => blob.includes(hint))) {
    return OPPORTUNITY_TYPES.FREELANCE;
  }

  return OPPORTUNITY_TYPES.JOB;
}

/**
 * A sheet row only represents an opportunity when it carries an identity.
 * Rows holding nothing but leftover Status/formatting are sheet noise, and
 * enriching them stamps a benchmark estimate on a row with no posting behind it.
 */
function isOpportunityRow(identity) {
  const fields = identity || {};
  return Boolean(
    cleanString(fields.role)
    || cleanString(fields.company)
    || cleanString(fields.jobUrl)
  );
}

function daysBetween(fromDateText, toDate) {
  const text = cleanString(fromDateText);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const from = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(from.getTime())) return null;
  return Math.floor((toDate.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

function shouldAcceptByAgeAndScore(postedDate, matchScore, maxAgeDays, now) {
  const ageDays = daysBetween(postedDate, now);
  if (ageDays === null) return true;
  if (ageDays > maxAgeDays && matchScore < 90) return false;
  return true;
}

function mapFreelanceFields(raw) {
  return {
    company: cleanString(raw.company || raw.author || raw.client),
    role: cleanString(raw.role || raw.requested_work),
    salary: cleanString(raw.salary || raw.budget) || 'Not listed',
    job_url: cleanString(raw.job_url || raw.post_url),
    notes: cleanString(raw.notes || raw.contact_instructions),
  };
}

module.exports = {
  OPPORTUNITY_TYPES,
  cleanString,
  slug,
  getDomain,
  normalizeUrl,
  extractJobId,
  extractStrongJobId,
  makeUniqueKey,
  makeContentIdentity,
  isListingHubUrl,
  isSpecificOpportunityUrl,
  isOpportunityRow,
  classifyOpportunityType,
  daysBetween,
  shouldAcceptByAgeAndScore,
  mapFreelanceFields,
};

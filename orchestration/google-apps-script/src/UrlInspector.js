/**
 * URL shape checks and dedupe key building. Whether a posting is still live is
 * LinkLiveness.js's job.
 * Keep Facebook permalinks allowed; reject group roots and search pages.
 */

/** Path ends on a board hub rather than a posting, e.g. /jobs, /careers, /search. */
const HUB_TAIL_PATTERN = new RegExp(
  '/(?:careers?|jobs?|job-search|job_search|positions?|openings?|opportunities'
  + '|vacancy|vacancies|join-us|work-with-us|search|browse|listings?)$',
  'i'
);

/**
 * Taxonomy browse pages: /categories/software-development, /industries/ai.
 * These list many postings, so they are never one opportunity on their own.
 */
const LISTING_TAXONOMY_PATTERN = new RegExp(
  '/(?:categor(?:y|ies)|industr(?:y|ies)|sectors?|professions?|fields?'
  + '|tags?|topics?|disciplines?|specializations?)(?:/|$)',
  'i'
);

function urlPath_(url) {
  const match = cleanString_(url).match(/^https?:\/\/[^/]+(\/[^?#]*)?/i);
  return match && match[1] ? match[1] : '/';
}

/**
 * Only ids strong enough to identify one posting: query ids, uuids, long numbers.
 * A slug is deliberately not enough, since every hub page has one.
 */
function extractStrongJobId_(url) {
  const value = cleanString_(url);
  const queryMatch = value.match(/[?&](?:jobid|job_id|gh_jid|requisitionid|reqid|position|id)=([^&#]+)/i);
  if (queryMatch) return decodeURIComponent(queryMatch[1]);

  const uuidMatch = value.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i);
  if (uuidMatch) return uuidMatch[0];

  const numericMatches = value.replace(/[?#].*$/, '').match(/\d{5,}/g);
  if (numericMatches && numericMatches.length) return numericMatches[numericMatches.length - 1];

  return '';
}

/**
 * A browse/listing page rather than a single posting. A taxonomy path is still
 * accepted when it carries a real posting id, e.g. /jobs/category/marketing/8692916.
 */
function isListingHubUrl_(url) {
  const path = urlPath_(url).replace(/\/+$/, '');
  if (!path) return true;
  if (HUB_TAIL_PATTERN.test(path)) return true;
  return LISTING_TAXONOMY_PATTERN.test(path) && !extractStrongJobId_(url);
}

/**
 * Pages that answer a logged-out fetch with a content-free shell: HTTP 200, no title
 * and no post text. Liveness therefore reads a filled gig exactly like an open one, so
 * such a row can never be retired on evidence and would sit in the sheet forever.
 * Only a source dedicated to the platform may introduce one, because promoting that
 * source is how the trade-off gets accepted deliberately.
 */
function isUnverifiableUrl_(url) {
  return /^https?:\/\/(?:[a-z0-9-]+\.)*facebook\.com\//i.test(cleanString_(url));
}

/** Facebook-dedicated sources, by the fb_ id convention the catalog uses. */
function isFacebookSourceId_(sourceId) {
  return /^fb_|facebook/i.test(cleanString_(sourceId));
}

function isSpecificOpportunityUrl_(url, opportunityType) {
  const value = cleanString_(url);
  if (!/^https?:\/\//i.test(value)) return false;

  const genericPatterns = [
    /linkedin\.com\/jobs\/search/i,
    /indeed\.[^/]+\/(?:jobs|q-)/i,
    /alljobs\.co\.il\/SearchResults/i,
    /drushim\.co\.il\/(?:jobs|search)\?/i,
    /google\.[^/]+\/search/i,
    /facebook\.com\/groups\/[^/]+\/?$/i,
    /facebook\.com\/groups\/[^/]+\/?\?.*$/i,
    /facebook\.com\/search/i,
  ];

  if (genericPatterns.some((pattern) => pattern.test(value))) return false;
  if (/gotfriends\.co\.il\/jobslobby\//i.test(value)) {
    const segments = urlPath_(value).split('/').filter(Boolean);
    const last = segments[segments.length - 1] || '';
    if (!/^\d{5,7}$/.test(last)) return false;
    if (/[?&](?:page|total|q|search)=/i.test(value)) return false;
  }
  if (isListingHubUrl_(value)) return false;

  if (opportunityType === CONFIG.OPPORTUNITY_TYPES.FREELANCE) {
    // Public Facebook post permalinks are valid freelance sources.
    if (/facebook\.com\/(?:groups\/[^/]+\/permalink\/\d+|[^/]+\/posts\/\d+|permalink\.php)/i.test(value)) {
      return true;
    }
  }

  return true;
}

function isSpecificJobUrl_(url) {
  return isSpecificOpportunityUrl_(url, CONFIG.OPPORTUNITY_TYPES.JOB);
}

function makeUniqueKey_(company, role, url) {
  const id = extractJobId_(url) || getDomain_(url);
  return `${slug_(company)}|${slug_(role)}|${slug_(id)}`.toLowerCase();
}

function extractJobId_(url) {
  const value = cleanString_(url);
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

function makeContentIdentity_(company, role, url, sourceType, location) {
  const normalizedUrl = normalizeUrl_(url);
  if (normalizedUrl) return `url:${normalizedUrl}`;
  return `content:${slug_(sourceType)}|${slug_(company)}|${slug_(role)}|${slug_(location || '')}`;
}

function normalizeUrl_(url) {
  let value = cleanString_(url).replace(/#.*$/, '');
  value = value.replace(/([?&])(utm_[^=]+|trk|trackingId|refId|source|src|rdid)=[^&]*/gi, '$1');
  value = value.replace(/[?&]+$/, '').replace(/\?&/, '?').replace(/&&+/g, '&');
  return value.replace(/\/+$/, '').toLowerCase();
}

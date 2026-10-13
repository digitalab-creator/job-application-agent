/**
 * Which company boards to read, and how to read each ATS.
 *
 * Applicant tracking systems publish a company's open roles as JSON so the company can
 * embed its own careers page. Reading that is using the feed as intended — no key, no
 * rate limit, no scraping — and it returns the exact posting URL a candidate applies
 * through, which is what the web-search route kept failing to produce.
 *
 * To follow a new company: find its board slug in its careers URL and add one line to
 * ATS_COMPANIES. Verify with the "Check ATS company boards" menu action.
 */

/**
 * Each provider maps its own payload onto one shape: { id, title, location, url, posted }.
 * Adding another ATS means adding an entry here, not touching the fetch or filter code.
 */
const ATS_PROVIDERS = Object.freeze({
  greenhouse: Object.freeze({
    label: 'Greenhouse',
    endpoint: (slug) => `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
    extract: (payload) => (payload && Array.isArray(payload.jobs) ? payload.jobs : []).map((job) => ({
      id: String(job.id || ''),
      title: cleanString_(job.title),
      location: cleanString_(job.location && job.location.name),
      url: cleanString_(job.absolute_url),
      posted: atsDate_(job.first_published || job.updated_at),
    })),
  }),
  lever: Object.freeze({
    label: 'Lever',
    endpoint: (slug) => `https://api.lever.co/v0/postings/${slug}?mode=json`,
    extract: (payload) => (Array.isArray(payload) ? payload : []).map((job) => ({
      id: String(job.id || ''),
      title: cleanString_(job.text),
      location: cleanString_(job.categories && job.categories.location),
      url: cleanString_(job.hostedUrl || job.applyUrl),
      posted: atsDate_(job.createdAt),
    })),
  }),
  ashby: Object.freeze({
    label: 'Ashby',
    endpoint: (slug) => `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
    extract: (payload) => (payload && Array.isArray(payload.jobs) ? payload.jobs : []).map((job) => ({
      id: String(job.id || ''),
      title: cleanString_(job.title),
      location: cleanString_(job.location),
      url: cleanString_(job.jobUrl || job.applyUrl),
      posted: atsDate_(job.publishedAt),
    })),
  }),
});

/**
 * Israeli tech companies with a reachable board, each verified to answer 200 with live
 * Israel-based roles. Slugs that 404 are simply skipped and logged, so a company moving
 * off its ATS degrades to one wasted fetch rather than a failed run.
 */
const ATS_COMPANIES = Object.freeze([
  Object.freeze({ slug: 'similarweb', provider: 'greenhouse', label: 'Similarweb' }),
  Object.freeze({ slug: 'taboola', provider: 'greenhouse', label: 'Taboola' }),
  Object.freeze({ slug: 'payoneer', provider: 'greenhouse', label: 'Payoneer' }),
  Object.freeze({ slug: 'appsflyer', provider: 'greenhouse', label: 'AppsFlyer' }),
  Object.freeze({ slug: 'via', provider: 'greenhouse', label: 'Via' }),
  Object.freeze({ slug: 'forter', provider: 'greenhouse', label: 'Forter' }),
  Object.freeze({ slug: 'fireblocks', provider: 'greenhouse', label: 'Fireblocks' }),
  Object.freeze({ slug: 'jfrog', provider: 'greenhouse', label: 'JFrog' }),
  Object.freeze({ slug: 'axonius', provider: 'greenhouse', label: 'Axonius' }),
  Object.freeze({ slug: 'lightricks', provider: 'greenhouse', label: 'Lightricks' }),
  Object.freeze({ slug: 'melio', provider: 'greenhouse', label: 'Melio' }),
  Object.freeze({ slug: 'augury', provider: 'greenhouse', label: 'Augury' }),
  Object.freeze({ slug: 'riskified', provider: 'greenhouse', label: 'Riskified' }),
  Object.freeze({ slug: 'orcasecurity', provider: 'greenhouse', label: 'Orca Security' }),
  Object.freeze({ slug: 'yotpo', provider: 'greenhouse', label: 'Yotpo' }),
  Object.freeze({ slug: 'cybereason', provider: 'greenhouse', label: 'Cybereason' }),
  Object.freeze({ slug: 'bringg', provider: 'greenhouse', label: 'Bringg' }),
]);

function atsDate_(value) {
  if (!value) return '';
  // Greenhouse and Ashby send ISO strings; Lever sends epoch milliseconds.
  if (typeof value === 'number') {
    const fromEpoch = new Date(value);
    return Number.isNaN(fromEpoch.getTime())
      ? ''
      : Utilities.formatDate(fromEpoch, CONFIG.TIME_ZONE, 'yyyy-MM-dd');
  }
  const match = cleanString_(value).match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
}

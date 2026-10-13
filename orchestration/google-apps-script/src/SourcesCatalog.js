/**
 * Full Israel Sources catalog. The Sources sheet seeds from this.
 *
 * Enablement policy: ACTIVE_SOURCE_IDS is the roster that runs. Every other row stays
 * in the catalog as a parked reference — promote one by adding its id to the roster.
 * The budget is split evenly across the roster, so its size sets how often any single
 * source comes around: a smaller roster means each source is checked more often.
 * The per-row `enabled` / `mode` arguments record the original phase-1 intent and are
 * overridden here.
 */
const TOS_RESTRICTED_SOURCE_IDS = Object.freeze([
  'il_alljobs',
  'web_indeed_il',
  'web_linkedin_public',
]);

/**
 * Sources of this type read mail the boards already sent us rather than visiting them.
 * They are exempt from the rotation because they cost no web search and their value is
 * being read the day an alert lands, not whenever their turn comes around.
 */
const EMAIL_ALERT_SOURCE_TYPE = 'email_alert';

/** Applicant tracking boards read through their own public JSON APIs. */
const ATS_API_SOURCE_TYPE = 'ats_api';

/**
 * The rotation exists to ration expensive web_search discovery. These types fetch
 * structured listings instead, so they cost a fraction of a search and are read on every
 * run rather than queued behind boards that do need one.
 */
const ALWAYS_ON_SOURCE_TYPES = Object.freeze([EMAIL_ALERT_SOURCE_TYPE, ATS_API_SOURCE_TYPE]);

/**
 * Sources that publish individually addressable postings a web search can actually
 * reach. Login-walled feeds (Facebook groups), pure aggregators that only restate
 * other boards, and tender portals are parked: they burn a slot per run and return
 * hub pages or duplicates instead of postings.
 */
const ACTIVE_SOURCE_IDS = Object.freeze([
  // Job alert mail — the only lawful route to LinkedIn, AllJobs and Indeed
  'email_job_alerts',
  // Company boards read straight from their ATS APIs — free, exact, no search needed
  'api_ats_boards',
  // Applicant tracking systems via search, for companies outside the ATS roster
  'web_ats_comeet',
  // Major Israeli employee boards
  'il_drushim',
  'il_jobmaster',
  // Israeli tech placement agencies
  'il_comblack',
  'il_gotfriends',
  'il_sqlink',
  'il_ethosia',
  'il_dialog',
  // Broad discovery
  'web_company_careers',
  'il_taasia',
  // Freelance and project work
  'il_xplace',
  'web_freelance_projects',
  'il_mploy',
]);

function getSourcesCatalog_() {
  return rawSourcesCatalog_().map((source) => {
    if (TOS_RESTRICTED_SOURCE_IDS.indexOf(source.source_id) !== -1) {
      return Object.assign({}, source, { enabled: false, mode: 'alerts_only' });
    }
    const active = ACTIVE_SOURCE_IDS.indexOf(source.source_id) !== -1;
    return Object.assign({}, source, { enabled: active, mode: 'auto' });
  });
}

function rawSourcesCatalog_() {
  return [
    // Alert mail: query_or_url is the Gmail label, the boundary of what the script may read
    s_('email_job_alerts', EMAIL_ALERT_SOURCE_TYPE, 'Job alert emails', CONFIG.GMAIL_ALERTS.LABEL, 'A', 'auto', 'Both', true, 1, 'LinkedIn/AllJobs/Indeed/Drushim alerts; no rotation slot'),
    s_('api_ats_boards', ATS_API_SOURCE_TYPE, 'ATS company boards', 'greenhouse+lever+ashby', 'A', 'auto', 'Job', true, 1, 'Keyless public board APIs for Israeli tech companies'),

    // Phase 1 ON
    s_('il_xplace', 'web_projects', 'XPlace', 'https://www.xplace.com/il/', 'B', 'auto', 'Freelance', true, 1, 'IL freelance/projects marketplace'),
    s_('il_taasia', 'web_jobs', 'Taasia', 'https://www.taasia.com/', 'A', 'auto', 'Both', true, 1, 'Digital/PPC/SEO/AI listings'),
    s_('il_mploy', 'web_jobs', 'Mploy', 'https://www.mploy.co.il/', 'A/B', 'auto', 'Both', true, 1, 'Aggregates social hiring posts'),
    s_('il_janglo_rss', 'rss', 'Janglo Jobs RSS', 'https://www.janglo.net/component/mtree/rss', 'A', 'auto', 'Both', true, 1, 'Prefer RSS over HTML'),
    s_('il_gov_procurement', 'web_projects', 'Gov Procurement', 'https://www.mr.gov.il/', 'A', 'auto', 'Freelance', true, 1, 'מינהל הרכש הממשלתי'),
    s_('web_ats_comeet', 'web_jobs', 'Comeet ATS', 'comeet.com', 'A', 'auto', 'Job', true, 1, 'IL-heavy ATS'),
    s_('web_ats_lever', 'web_jobs', 'Lever ATS', 'jobs.lever.co', 'A', 'auto', 'Job', true, 2, 'Public Lever boards'),
    s_('web_ats_greenhouse', 'web_jobs', 'Greenhouse ATS', 'greenhouse.io', 'A', 'auto', 'Job', true, 2, 'Public Greenhouse boards'),
    s_('il_jobmaster', 'web_jobs', 'JobMaster', 'https://www.jobmaster.co.il/', 'A/B', 'auto', 'Job', true, 1, 'Major IL employee board'),
    s_('il_drushim', 'web_jobs', 'Drushim', 'https://www.drushim.co.il/', 'A/B', 'auto', 'Job', true, 1, 'Major IL board; recent only'),

    // Social-intent freelance — parked: group posts sit behind a login wall the
    // search cannot read. il_mploy covers the same posts on an open site.
    s_('fb_marketing_il', 'facebook_group', 'FB Marketing IL', 'https://www.facebook.com/groups/superface.marketing.digital/', 'B/C', 'auto', 'Freelance', true, 3, 'Informal פרילנס / המלצות posts'),
    s_('fb_ai_il', 'facebook_group', 'FB AI Jobs IL', 'https://www.facebook.com/groups/1027511938680919/', 'B/C', 'auto', 'Freelance', true, 3, 'Informal AI/automation freelance asks'),
    s_('fb_digital_marketing_il', 'facebook_group', 'FB Digital Marketing IL', 'https://www.facebook.com/groups/digitalmarketingisrael/', 'B/C', 'auto', 'Freelance', true, 3, 'Marketing/digital recommendation posts'),
    s_('fb_shivuk_digital', 'facebook_group', 'FB שיווק דיגיטל ומדיה', 'https://www.facebook.com/groups/marketing.digital.social/', 'B/C', 'auto', 'Freelance', true, 3, 'Hebrew marketing/digital social hiring'),

    // Seeded OFF / alerts
    s_('il_freelancer_org', 'web_projects', 'Freelancer.org.il', 'https://www.freelancer.org.il/', 'B', 'auto', 'Freelance', true, 2, ''),
    s_('il_scholargigs', 'web_projects', 'ScholarGigs', 'https://www.scholargigs.com/', 'B', 'auto', 'Freelance', false, 5, 'Host stopped responding — recheck before promoting'),
    s_('il_4israel', 'web_jobs', '4Israel', 'https://www.4israel.co.il/', 'B', 'auto', 'Both', false, 5, 'Cloudflare 403 to direct fetch'),
    s_('web_freelance_projects', 'web_projects', 'Other freelance projects', 'israel freelance project', 'B', 'auto', 'Freelance', true, 2, 'Intent-phrase web discovery'),
    s_('il_jobnet', 'web_jobs', 'Jobnet', 'https://www.jobnet.co.il/', 'A', 'auto', 'Job', false, 4, ''),
    s_('il_muvtal', 'web_jobs', 'Muvtal', 'https://www.muvtal.co.il/', 'A', 'auto', 'Job', false, 5, ''),
    s_('il_careerjet', 'web_jobs', 'Careerjet IL', 'https://www.careerjet.co.il/', 'B', 'auto', 'Job', false, 6, 'Aggregator'),
    s_('il_alljobs', 'web_jobs', 'AllJobs', 'https://www.alljobs.co.il/', 'C', 'alerts_only', 'Job', false, 9, 'ToS: no commercial scrape'),
    s_('web_indeed_il', 'web_jobs', 'Indeed IL', 'https://il.indeed.com/', 'C', 'alerts_only', 'Job', false, 9, ''),
    s_('web_linkedin_public', 'web_jobs', 'LinkedIn Jobs', 'linkedin.com/jobs', 'C', 'alerts_only', 'Job', false, 9, 'No scrape'),
    s_('il_employment_service', 'web_jobs', 'Employment Service', 'https://www.taasuka.gov.il/', 'B/C', 'alerts_only', 'Job', false, 8, ''),
    s_('il_techjob', 'web_jobs', 'TechJob', 'https://www.techjob.co.il/', 'A/B', 'auto', 'Job', false, 4, ''),
    s_('il_gotfriends', 'web_jobs', 'GotFriends', 'https://www.gotfriends.co.il/', 'A/B', 'auto', 'Job', false, 4, 'Postings under /jobslobby/; only /jobssalary is robots-blocked'),
    s_('il_dialog', 'web_jobs', 'Dialog', 'https://www.dialog.co.il/', 'A/B', 'auto', 'Job', false, 4, ''),
    s_('il_nisha', 'web_jobs', 'Nisha', 'https://www.nisha.co.il/', 'A/B', 'auto', 'Job', false, 4, ''),
    s_('il_jobinfo', 'web_jobs', 'JobInfo', 'https://www.jobinfo.co.il/', 'A/B', 'auto', 'Job', false, 4, 'Cloudflare 403 to direct fetch'),
    // Apex only: the certificate does not cover the www host, which fails TLS outright.
    s_('il_comblack', 'web_jobs', 'Comblack', 'https://comblack.co.il/', 'A', 'auto', 'Job', false, 4, 'Postings live under /careers/position-<id>/'),
    s_('il_ethosia', 'web_jobs', 'Ethosia', 'https://www.ethosia.co.il/', 'B', 'auto', 'Job', false, 5, ''),
    s_('il_sqlink', 'web_jobs', 'SQLink', 'https://www.sqlink.com/', 'A/B', 'auto', 'Job', false, 4, ''),
    s_('il_experis', 'web_jobs', 'Experis Israel', 'https://www.experis.co.il/', 'A/B', 'auto', 'Job', false, 4, ''),
    s_('il_seehr', 'web_jobs', 'SeeHR', 'https://www.seehr.co.il/', 'B', 'auto', 'Job', false, 5, ''),
    s_('il_gov_il_tenders', 'web_projects', 'Gov.il tenders', 'https://www.gov.il/', 'A/B', 'auto', 'Freelance', false, 4, 'Cloudflare 403 to direct fetch'),
    s_('il_govo', 'web_projects', 'GOVO', 'https://www.govo.co.il/', 'B', 'auto', 'Freelance', false, 6, ''),
    s_('il_mod_tenders', 'web_projects', 'MOD tenders', 'https://www.mod.gov.il/', 'A/B', 'auto', 'Freelance', false, 5, ''),
    s_('il_public_entities', 'web_projects', 'Public entities tenders', 'israel tender careers', 'A', 'auto', 'Freelance', false, 6, ''),
    s_('web_ats_ashby', 'web_jobs', 'Ashby ATS', 'ashbyhq.com', 'A', 'auto', 'Job', false, 3, ''),
    s_('web_ats_workable', 'web_jobs', 'Workable ATS', 'workable.com', 'B', 'auto', 'Job', false, 4, ''),
    s_('web_company_careers', 'web_jobs', 'Company careers', 'israel careers jobs', 'A/B', 'auto', 'Job', false, 4, ''),
    s_('il_secret_tlv', 'web_jobs', 'Secret Tel Aviv Jobs', 'https://www.secrettelaviv.com/', 'A/B', 'auto', 'Job', false, 4, ''),
    s_('il_nbn_jobs', 'web_jobs', 'Nefesh BNefesh Jobs', 'https://www.nbn.org.il/', 'B', 'auto', 'Job', false, 5, ''),
    s_('il_jobs_in_israel', 'web_jobs', 'Jobs in Israel', 'https://www.jobsinisrael.com/', 'A/B', 'auto', 'Job', false, 5, ''),
    s_('il_israeljobs', 'web_jobs', 'IsraelJobs', 'https://www.israeljobs.com/', 'A/B', 'auto', 'Job', false, 5, 'TLS certificate does not match the domain'),
    s_('il_workes', 'web_jobs', 'Workes', 'https://www.workes.co.il/', 'B', 'auto', 'Job', false, 6, ''),
    s_('tg_il_jobs', 'web_social', 'Telegram IL jobs', 'https://t.me/', 'B', 'auto', 'Both', false, 2, 'Enable after adding channel URLs'),
    s_('web_reddit_jobs', 'web_social', 'Reddit', 'reddit.com jobs freelance', 'B', 'auto', 'Both', false, 9, 'Weak IL signal'),
    s_('web_x_public', 'web_social', 'X/Twitter', 'twitter.com hiring israel', 'B', 'auto', 'Both', false, 9, 'Weak IL signal'),
    s_('global_upwork', 'web_projects', 'Upwork', 'https://www.upwork.com/', 'C', 'alerts_only', 'Freelance', false, 9, ''),
    s_('global_fiverr', 'web_projects', 'Fiverr', 'https://www.fiverr.com/', 'C', 'alerts_only', 'Freelance', false, 9, ''),
    s_('global_wellfound', 'web_jobs', 'Wellfound', 'https://wellfound.com/', 'C', 'alerts_only', 'Job', false, 9, ''),
  ];
}

/**
 * Israel-local sources are geo-scoped by their own domain. Global sources
 * (Lever, Greenhouse, generic web discovery) are not, so callers must add an
 * explicit Israel clause or they return mostly US listings.
 */
function isIsraelScopedSource_(source) {
  if (/^(il_|fb_|tg_il)/i.test(cleanString_(source.source_id))) return true;
  return /\.il(\b|\/)|janglo|jobmaster|drushim|alljobs/i.test(cleanString_(source.query_or_url));
}

function s_(sourceId, type, label, queryOrUrl, scrapeTier, mode, opportunityTypes, enabled, priority, notes) {
  return {
    source_id: sourceId,
    type,
    label,
    query_or_url: queryOrUrl,
    scrape_tier: scrapeTier,
    mode,
    opportunity_types: opportunityTypes,
    enabled,
    priority,
    max_calls_per_run: 1,
    max_results: CONFIG.MAX_RESULTS_PER_BATCH,
    notes: notes || '',
  };
}

const SOURCE_HEADERS = Object.freeze([
  'source_id',
  'type',
  'label',
  'query_or_url',
  'scrape_tier',
  'mode',
  'opportunity_types',
  'enabled',
  'priority',
  'max_calls_per_run',
  'max_results',
  'llm_relevant',
  'user_relevant',
  'user_not_relevant',
  'user_pending',
  'pct_relevant_of_llm',
  'pct_relevant_of_marked',
  'candidates_raw',
  'duplicates',
  'inaccessible',
  'api_ms',
  'runs',
  'yield_7d',
  'status',
  'last_run_at',
  'notes',
]);

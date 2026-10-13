/**
 * Single source of truth for Apps Script constants.
 * Prefer Search Config preferences for tunables that change often.
 */
const CONFIG = Object.freeze({
  SPREADSHEET_ID: '1fxnXLQndeiw7xT1r4NWwO01J8rOMY5J2zQcjHm3HqnQ',
  // Standard GCP project number for OAuth consent (set in Apps Script Project Settings).
  GCP_PROJECT_NUMBER: '1046297777369',
  TIME_ZONE: 'Asia/Jerusalem',
  OPENAI_URL: 'https://api.openai.com/v1/responses',
  // Free, tiny endpoint used only to prove a stored key still works.
  OPENAI_MODELS_URL: 'https://api.openai.com/v1/models?limit=1',
  OPENAI_KEY_PREFIX: 'sk-',
  DEFAULT_MODEL: 'gpt-4.1',
  MAX_RESULTS_PER_BATCH: 12,
  // Rows re-verified per sheet per run. Checks run in parallel, so the ceiling is
  // fetch quota rather than wall time.
  MAX_EXISTING_RECHECK: 60,
  // Consecutive runs a row may stay unreachable before it is treated as dead.
  // A dead hostname closes immediately; this covers hosts that merely stop answering.
  MAX_UNREACHABLE_STRIKES: 3,
  LIVENESS: Object.freeze({
    MAX_REDIRECT_HOPS: 5,
    FETCH_TIMEOUT_SECONDS: 20,
    MAX_BODY_CHARS: 300000,
    MAX_PARALLEL_FETCH: 30,
  }),
  // Each web search adds a tool fee and its retrieved page content to the context
  // that every later turn re-sends, so this caps the dominant cost driver.
  MAX_TOOL_CALLS: 8,
  WEB_SEARCH_CONTEXT_SIZE: 'medium',
  MAX_URL_VERIFICATIONS_DEFAULT: 40,
  // USD per 1M tokens, per model, plus the hosted web_search tool fee per call.
  // Update these when OpenAI changes prices — they only drive cost reporting.
  MODEL_PRICING_USD: Object.freeze({
    'gpt-4.1': Object.freeze({ input: 2, cachedInput: 0.5, output: 8 }),
    'gpt-4.1-mini': Object.freeze({ input: 0.4, cachedInput: 0.1, output: 1.6 }),
    'gpt-4.1-nano': Object.freeze({ input: 0.1, cachedInput: 0.025, output: 0.4 }),
  }),
  FALLBACK_MODEL_PRICING_USD: Object.freeze({ input: 2, cachedInput: 0.5, output: 8 }),
  WEB_SEARCH_CALL_USD: 0.01,
  // Daily trigger, used to project a monthly figure from one run.
  RUNS_PER_MONTH: 30,
  // Hard spend cap. Overridable per-sheet via the monthly_budget_ils preference.
  MONTHLY_BUDGET_ILS_DEFAULT: 100,
  // Bootstrap cost per source call until real runs calibrate the average.
  ESTIMATED_CALL_COST_USD: 0.15,
  // Our spend figure comes from reported tokens, but OpenAI also bills internal
  // sub-searches it does not report. Spend only this share of the stated budget so
  // the real invoice stays under it.
  BUDGET_SAFETY_FACTOR: 0.85,
  MIN_MATCH_SCORE_DEFAULT: 70,
  MAX_AGE_DAYS_DEFAULT: 14,
  MIN_MONTHLY_SALARY_ILS: 23000,
  USD_TO_ILS_RATE: 3.7,
  FULL_TIME_MONTHLY_HOURS: 182,
  COLUMN_COUNT: 17,
  OPPORTUNITY_TYPES: Object.freeze({
    JOB: 'Job',
    FREELANCE: 'Freelance',
  }),
  // Script Property keys. Never read these names as inline strings elsewhere.
  PROPS: Object.freeze({
    OPENAI_API_KEY: 'OPENAI_API_KEY',
    OPENAI_MODEL: 'OPENAI_MODEL',
    NOTIFY_EMAIL: 'NOTIFY_EMAIL',
  }),
  SHEETS: Object.freeze({
    JOBS: 'Jobs',
    FREELANCE: 'Freelance',
    SEARCH_CONFIG: 'Search Config',
    CLOSED: 'Closed & Seen',
    LOG: 'Automation Log',
    SOURCES: 'Sources',
  }),
  USER_RELEVANT_STATUSES: Object.freeze(['Applied', 'Interview', 'Offer', 'Hired']),
  USER_NOT_RELEVANT_STATUS: 'Not Relevant',
  // Job alert emails. Boards that forbid scraping still mail their listings to a
  // subscriber, so alerts reach LinkedIn/AllJobs/Indeed without touching their sites.
  // Only mail carrying LABEL is ever read, so the Gmail filter is the access boundary.
  GMAIL_ALERTS: Object.freeze({
    LABEL: 'JobAlerts',
    LOOKBACK_DAYS: 3,
    MAX_THREADS: 30,
    MAX_MESSAGES_PER_THREAD: 3,
    // Links are cheap to collect but each one costs prompt tokens to score.
    MAX_LINKS_PER_RUN: 60,
    // Alerts already passed the board's own filters, so demand less than web discovery.
    MIN_MATCH_SCORE: 60,
  }),
  // Scoring pre-fetched listings reads supplied text only, so the small model suffices.
  LISTING_SCORING_MODEL: 'gpt-4.1-mini',
  // Applicant tracking systems publish their boards as open JSON for embedding, so these
  // reads need no key and cost nothing. Israel and title filtering happen before any
  // model call, which is what keeps a few hundred fetched roles affordable to score.
  ATS: Object.freeze({
    TIMEOUT_SECONDS: 20,
    // Fetched in one parallel round, so this is bounded by fetch quota, not wall time.
    MAX_PARALLEL_FETCH: 20,
    // Ceiling on roles handed to the scorer after filtering, newest first.
    MAX_LISTINGS_PER_RUN: 40,
    // A board's own listing is strong evidence, so the bar sits near normal discovery.
    MIN_MATCH_SCORE: 65,
  }),
  MAX_SOURCE_CALLS_PER_RUN: 12,
  FREELANCE_MIN_MATCH_SCORE: 65,
  FREELANCE_EXTRA_AGE_DAYS: 7,
  // Equal budget share by default. After this many barren runs, the source keeps
  // running but at SOURCE_SHARE_WEIGHT_PENALTY instead of a full share.
  SOURCE_ZERO_YIELD_DISABLE_RUNS: 7,
  SOURCE_SHARE_WEIGHT_DEFAULT: 1,
  SOURCE_SHARE_WEIGHT_PENALTY: 0.25,
  // User marked "Not Relevant" often enough → same reduced share.
  SOURCE_NOT_RELEVANT_PENALTY_RATIO: 0.7,
  SOURCE_NOT_RELEVANT_MIN_MARKED: 3,
  // Appended to discovery queries on non-Israeli domains (global ATS, aggregators).
  ISRAEL_GEO_QUERY_TERMS: Object.freeze([
    'Israel',
    'Tel Aviv',
    'ישראל',
  ]),
  // Social-intent phrases for freelance gigs (not employment job titles).
  FREELANCE_INTENT_PHRASES: Object.freeze([
    'מחפש פרילנסר',
    'מחפשת פרילנסר',
    'מחפש פרילנס',
    'מחפשת פרילנס',
    'מחפש המלצות',
    'מחפשת המלצות',
    'דרוש פרילנסר',
    'דרושה פרילנסרית',
    'דרוש פרילנס',
    'מנהלת קמפיינים לפרילנס',
    'מנהל קמפיינים לפרילנס',
    'ניהול קמפיינים',
    'looking for a freelancer',
    'looking for recommendations',
    'need a freelancer',
    'freelancer recommendations',
  ]),
  FREELANCE_SKILL_TERMS: Object.freeze([
    'מטא',
    'Meta ads',
    'PPC',
    'פרסום',
    'SaaS',
    'AI',
    'אוטומציה',
    'דף נחיתה',
    'growth',
    'GenAI',
    'LLM',
    'CRO',
    'funnel',
  ]),
  // Commute policy: remote OK anywhere (if Israel-eligible); office/hybrid must be ~1h from base.
  BASE_CITY: 'Petah Tikva',
  COMMUTE_MAX_MINUTES: 60,
  GEOGRAPHY_RULE: [
    'GEOGRAPHY / COMMUTE (hard rule)',
    '- Base: Petah Tikva, Israel. The candidate can only work from Israel and has Israeli work authorization only.',
    '- Remote: ACCEPT only when the listing page allows applicants based in Israel',
    '  (worldwide / anywhere / EMEA / Israel named explicitly, or no country restriction at all).',
    '- REJECT any remote role whose page limits hiring to countries or regions that exclude Israel',
    '  (for example "US only", "must be authorized to work in the United States", "UK only",',
    '  "EU residents only", "must reside in Canada", a named-country-only list, or a US/UK/EU payroll requirement).',
    '  Open the page and read the eligibility/location section before accepting a remote role.',
    '- A remote role that states NO location restriction is acceptable — keep it.',
    '  Absence of a restriction is not a restriction, so never infer one from the company HQ country.',
    '- Set geo_eligibility for every result:',
    '    israel_eligible          — the page names Israel (or an Israeli city) as an accepted location',
    '    worldwide                — the page says anywhere / global / EMEA',
    '    no_restriction_stated    — you read the page and it states no location or work-authorization limit',
    '    restricted_excludes_israel — hiring is limited to countries/regions that exclude Israel',
    '    unknown                  — you could not read the eligibility section',
    '  When a restriction exists, quote the exact restriction sentence in notes.',
    '- Hybrid / on-site / office: office must be within ~1 hour drive of Petah Tikva',
    '  (Gush Dan / Sharon / nearby center: Tel Aviv, Ramat Gan, Bnei Brak, Herzliya,',
    '  Ra\'anana, Rishon LeZion, Holon, Modiin, Netanya, Rehovot, Airport area, etc.).',
    '- REJECT office roles whose primary office is clearly farther (Haifa, Be\'er Sheva,',
    '  Eilat, north/south periphery, or abroad requiring relocation).',
    '- Prefer naming the city in location when the role is hybrid/on-site.',
  ].join('\n'),
  // Heuristic tokens for hard filter (not live Maps drive times).
  COMMUTE_ALLOW_TOKENS: Object.freeze([
    'petah tikva', 'petach tikva', 'פתח תקווה', 'פתח תקוה',
    'tel aviv', 'tel-aviv', 'תל אביב', 'tlv',
    'ramat gan', 'רמת גן', 'bnei brak', 'bnei-brak', 'בני ברק',
    'givatayim', 'givataim', 'גבעתיים',
    'holon', 'חולון', 'bat yam', 'בת ים',
    'rishon', 'ראשון לציון', 'ness ziona', 'נס ציונה',
    'rehovot', 'רחובות', 'yavne', 'יבנה',
    'herzliya', 'herzelia', 'הרצליה',
    "ra'anana", 'raanana', 'רעננה',
    'kfar saba', 'כפר סבא', 'hod hasharon', 'הוד השרון',
    'yehud', 'יהוד', 'or yehuda', 'אור יהודה',
    'kiryat ono', 'קריית אונו', 'givat shmuel', 'גבעת שמואל',
    'shoham', 'שוהם', 'modiin', "modi'in", 'מודיעין',
    'lod', 'לוד', 'ramla', 'רמלה', 'airport', 'נתבג', 'ben gurion',
    'gush dan', 'גוש דן', 'sharon', 'השרון', 'center', 'מרכז',
    'netanya', 'נתניה', 'azur', 'אזור', 'savyon', 'סביון',
    'rosh haayin', 'ראש העין',
  ]),
  COMMUTE_FAR_TOKENS: Object.freeze([
    'haifa', 'חיפה', "be'er sheva", 'beer sheva', 'beersheba', 'באר שבע',
    'eilat', 'אילת', 'nazareth', 'נצרת', 'tiberias', 'טבריה',
    'afula', 'עפולה', 'acre', 'akko', 'עכו', 'nahariya', 'נהריה',
    'carmiel', 'כרמיאל', 'kiryat shmona', 'קריית שמונה',
    'dimona', 'דימונה', 'ashkelon', 'אשקלון', 'kiryat gat', 'קריית גת',
    'new york', 'nyc', 'london', 'berlin', 'amsterdam', 'dublin',
    'san francisco', 'bay area', 'seattle', 'austin', 'toronto',
    'relocation required', 'must relocate',
  ]),
  // Positive signals that an Israel-based candidate may apply to a remote role.
  ISRAEL_ELIGIBLE_TOKENS: Object.freeze([
    'israel', 'ישראל', 'israeli', 'emea', 'worldwide', 'world wide',
    'anywhere', 'any country', 'globally', 'global remote', 'fully distributed',
    'remote - global', 'remote (global)', 'מכל מקום',
    // Naming an Israeli city is itself proof the role is open to Israel.
    'tel aviv', 'תל אביב', 'petah tikva', 'petach tikva', 'פתח תקו',
    'herzliya', 'הרצליה', 'ramat gan', 'רמת גן', 'jerusalem', 'ירושלים',
    'haifa', 'חיפה', 'netanya', 'נתניה', 'beer sheva', 'באר שבע',
  ]),
  // Phrases that limit hiring to a region. Only blocking when no Israel signal is present.
  REMOTE_RESTRICTION_PHRASES: Object.freeze([
    'us only', 'u.s. only', 'usa only', 'us-only', 'united states only',
    'us based only', 'us-based only', 'based in the united states',
    'reside in the united states', 'located in the united states',
    'authorized to work in the united states', 'authorized to work in the us',
    'us work authorization', 'work authorization in the us', 'eligible to work in the us',
    'uk only', 'united kingdom only', 'based in the uk', 'right to work in the uk',
    'canada only', 'based in canada', 'reside in canada',
    'eu only', 'eu-only', 'european union only', 'eu residents only',
    'based in the eu', 'reside in the eu', 'eu work authorization',
    'india only', 'philippines only', 'latam only', 'brazil only', 'australia only',
    'must be located in', 'must reside in', 'must be based in',
    'only candidates located in', 'only candidates based in',
    'hiring in the following countries', 'open to candidates in',
    'not open to candidates outside', 'this role is limited to',
  ]),
  // Country/region names that imply a non-Israel hiring market when no Israel signal exists.
  REMOTE_FOREIGN_LOCATION_TOKENS: Object.freeze([
    'united states', 'usa', 'u.s.a', 'canada', 'united kingdom', 'england',
    'germany', 'france', 'spain', 'portugal', 'poland', 'romania', 'ukraine',
    'netherlands', 'belgium', 'ireland', 'sweden', 'denmark', 'norway', 'finland',
    'india', 'philippines', 'pakistan', 'bangladesh', 'vietnam', 'indonesia',
    'brazil', 'mexico', 'argentina', 'colombia', 'chile', 'peru',
    'australia', 'new zealand', 'singapore', 'malaysia', 'japan', 'china',
    'south africa', 'nigeria', 'kenya', 'ghana', 'egypt', 'turkey',
    'uae', 'dubai', 'saudi arabia', 'qatar', 'latam', 'apac',
  ]),
  HEADERS: Object.freeze([
    'Unique Key',
    'Found Date',
    'Posted Date',
    'Role',
    'Company',
    'Category',
    'Location',
    'Work Mode',
    'Salary',
    'Est. Salary Range',
    'Match Score',
    'Why It Fits',
    'Source',
    'Job URL',
    'Status',
    'Applied Date',
    'Notes',
  ]),
  COL_INDEX: Object.freeze({
    UNIQUE_KEY: 0,
    FOUND_DATE: 1,
    POSTED_DATE: 2,
    ROLE: 3,
    COMPANY: 4,
    CATEGORY: 5,
    LOCATION: 6,
    WORK_MODE: 7,
    SALARY: 8,
    EST_SALARY_RANGE: 9,
    MATCH_SCORE: 10,
    WHY_IT_FITS: 11,
    SOURCE: 12,
    JOB_URL: 13,
    STATUS: 14,
    APPLIED_DATE: 15,
    NOTES: 16,
  }),
  DEFAULT_FACEBOOK_SOURCES: Object.freeze([
    {
      url: 'https://www.facebook.com/groups/superface.marketing.digital/',
      label: 'Marketing digital Israel',
      category: 'Growth Marketing',
      priority: 1,
      enabled: true,
    },
    {
      url: 'https://www.facebook.com/groups/1027511938680919/',
      label: 'AI jobs Israel',
      category: 'Applied AI',
      priority: 1,
      enabled: true,
    },
    {
      url: 'https://www.facebook.com/groups/digitalmarketingisrael/',
      label: 'Digital Marketing Israel',
      category: 'Growth Marketing',
      priority: 1,
      enabled: true,
    },
  ]),
  CANDIDATE_PROFILE: [
    'Candidate: Or Shvartz, based in Petah Tikva, Israel.',
    '12+ years in PPC and performance marketing, including leadership and large-budget campaigns.',
    '5-6 years hands-on software development: Node.js, TypeScript, React, Python, PHP, APIs, databases and cloud deployment.',
    'Hands-on GenAI/LLM work: OpenAI APIs, LangChain/LangGraph, RAG, agents, automations, OCR and production AI products.',
    'Strong overlap across growth, analytics, CRO, product, marketing operations, technical delivery and business problem solving.',
    'Preferred seniority: Mid-Senior, Senior or Lead. Preferred work mode: remote or hybrid.',
    'Office/hybrid commute: office must be within ~1 hour drive of Petah Tikva (Gush Dan / Sharon / nearby center).',
    'Reject office roles in Haifa, Be\'er Sheva, Eilat, far north/south, or abroad requiring relocation.',
    'Also open to freelance/consulting: growth, PPC, funnel, landing pages, AI agents, automation and technical delivery.',
    'Prioritize opportunities with strong compensation and a credible path to an interview or paid engagement.',
  ].join('\n'),
});

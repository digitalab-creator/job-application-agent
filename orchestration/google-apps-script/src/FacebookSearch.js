/**
 * Best-effort PUBLIC Facebook search for informal freelance asks.
 * Gold standard: "מחפשת המלצות על מנהלת קמפיינים לפרילנס" — not ATS job titles.
 */
function searchFacebookSource_(source, categories, preferences, settings) {
  const today = Utilities.formatDate(new Date(), CONFIG.TIME_ZONE, 'yyyy-MM-dd');
  const categoryNames = categories.map((item) => item.category).join('; ');
  const intentKeywords = buildFreelanceIntentKeywordText_(settings);
  const skillTerms = CONFIG.FREELANCE_SKILL_TERMS.join('; ');
  const maxAge = settings.maxAgeDays + (CONFIG.FREELANCE_EXTRA_AGE_DAYS || 0);
  const minScore = Math.min(settings.minMatchScore, CONFIG.FREELANCE_MIN_MATCH_SCORE || 65);

  const prompt = `
Today is ${today}. Find PUBLIC Facebook posts from THIS ONE group only.

GROUP
${source.query_or_url}
Label: ${source.label}

GOAL — informal freelance / recommendation posts (NOT formal job ads)
Hunt posts where someone asks for a freelancer, recommendations, or short project help.
Gold-standard example (Hebrew):
"מחפשת המלצות על מנהלת קמפיינים לפרילנס. אני מקימה אתר חדש… צריכה מישהי עם ניסיון אמיתי בפרסום במטא… עדיפות למישהי עם ניסיון במוצר דיגיטלי / SaaS…"

INTENT PHRASES (primary search)
${intentKeywords}

SKILL COMPANIONS (fit filter, not required in every post)
${skillTerms}

ACCESS RULES
- Public content / public web indexes only. Never assume login.
- If login-walled or insufficient, omit and list miss_reasons (login_wall, no_public_permalink, index_not_found, etc.).
- Never return a generic group URL. Only specific post permalinks (…/permalink/… or posts/…).

FIELD MAPPING FOR INFORMAL POSTS
- role: infer a short English title from the prose (e.g. "Freelance Meta Campaign Manager").
- company: use the poster display name when known, otherwise "Private client".
- opportunity_type: always "Freelance".
- location: Israel / Remote / Not specified as evidenced.
- work_mode: Remote or Not specified for social gigs unless office is explicit.
- notes: short snippet of the ask + skills (Hebrew OK).
- job_url: public permalink only.
- category: pick one from: ${categoryNames}

CANDIDATE
${CONFIG.CANDIDATE_PROFILE}

${buildGeographyRuleText_()}

Rules: max ${source.max_results || 8} items; min score ${minScore}; prefer last ${settings.maxAgeDays} days, allow up to ${maxAge} for strong social fits.
source="${source.label}"; source_type="${source.source_id}"; opportunity_type must be Freelance.
Do NOT require ATS-style salary, company brand, or clean job titles.
`;

  const schema = buildOpportunitySchema_('opportunities');
  const result = callOpenAI_(
    prompt,
    schema,
    'facebook_opportunity_results',
    [
      'You research PUBLIC Facebook posts asking for freelancers or recommendations in one group.',
      'Prefer informal Hebrew/English recommendation posts over formal employment ads.',
      'Never claim private/login-walled access.',
      'Always populate miss_reasons when results are empty or partial.',
      'Return only structured JSON.',
    ].join(' ')
  );

  return {
    opportunities: (result.opportunities || []).map((item) => Object.assign({}, item, {
      source: item.source || source.label,
      source_type: source.source_id,
      source_id: source.source_id,
      opportunity_type: CONFIG.OPPORTUNITY_TYPES.FREELANCE,
      company: cleanString_(item.company) || 'Private client',
    })),
    search_notes: result.search_notes || '',
    inaccessible_count: Number(result.inaccessible_count) || 0,
    miss_reasons: result.miss_reasons || [],
    meta: result._meta || {},
  };
}

function buildFreelanceIntentKeywordText_(settings) {
  const fromSettings = cleanString_(settings && settings.facebookKeywords);
  const fromConfig = CONFIG.FREELANCE_INTENT_PHRASES.concat(CONFIG.FREELANCE_SKILL_TERMS).join('; ');
  // Prefer intent pack; append sheet keywords only if they add signal.
  if (!fromSettings) return fromConfig;
  if (/מחפש|פרילנס|freelancer|recommendations/i.test(fromSettings)) {
    return `${fromConfig}; ${fromSettings}`;
  }
  return fromConfig;
}

function classifyOpportunityType_(candidate) {
  const explicit = cleanString_(candidate.opportunity_type);
  if (explicit === CONFIG.OPPORTUNITY_TYPES.JOB || explicit === CONFIG.OPPORTUNITY_TYPES.FREELANCE) {
    return explicit;
  }

  const blob = [
    candidate.role,
    candidate.notes,
    candidate.why_it_fits,
    candidate.source,
    candidate.work_mode,
    candidate.source_type,
    candidate.source_id,
  ].map(cleanString_).join(' ').toLowerCase();

  const freelanceHints = [
    'freelance', 'freelancer', 'פרילנס', 'עצמאי', 'פרויקט', 'project based',
    'contract', 'consulting', 'consultant', 'hourly', 'retainer',
    'מחפש פרילנסר', 'מחפשת פרילנסר', 'דרוש פרילנסר', 'דרושה פרילנסרית',
    'מחפש המלצות', 'מחפשת המלצות', 'מכרז', 'tender', 'xplace',
    'private client', 'facebook_group',
  ];

  if (freelanceHints.some((hint) => blob.includes(hint))) {
    return CONFIG.OPPORTUNITY_TYPES.FREELANCE;
  }
  return CONFIG.OPPORTUNITY_TYPES.JOB;
}

function forceFreelanceTypeIfNeeded_(source, opportunityType) {
  if (!source) return opportunityType;
  if (source.type === 'facebook_group') return CONFIG.OPPORTUNITY_TYPES.FREELANCE;
  if (source.opportunity_types === 'Freelance') return CONFIG.OPPORTUNITY_TYPES.FREELANCE;
  return opportunityType;
}

/** @deprecated Use searchFacebookSource_ per Sources row. */
function searchFacebookBatch_(facebookSources, categories, preferences, settings) {
  const first = facebookSources && facebookSources[0];
  if (!first) {
    return {
      opportunities: [],
      search_notes: 'No facebook sources',
      inaccessible_count: 0,
      miss_reasons: ['index_not_found'],
      meta: {},
    };
  }
  return searchFacebookSource_({
    source_id: 'facebook_legacy',
    label: first.label || 'Facebook',
    query_or_url: first.url,
    max_results: CONFIG.MAX_RESULTS_PER_BATCH,
    type: 'facebook_group',
    opportunity_types: 'Freelance',
    notes: '',
  }, categories, preferences, settings);
}

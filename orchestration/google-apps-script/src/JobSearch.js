/**
 * Public-web job search via OpenAI web_search.
 */
function searchJobsBatch_(categories, preferences, settings) {
  const today = Utilities.formatDate(new Date(), CONFIG.TIME_ZONE, 'yyyy-MM-dd');
  const categoryText = categories
    .map((item) => [
      `Category: ${item.category}`,
      `Priority: ${item.priority}`,
      `Titles: ${item.titles.join('; ')}`,
      `Notes: ${item.notes || '(none)'}`,
    ].join('\n'))
    .join('\n\n');

  const preferenceText = Object.keys(preferences)
    .filter((key) => !key.startsWith('facebook_') && key !== 'dry_run')
    .map((key) => `${key}: ${preferences[key]}`)
    .join('\n');

  const prompt = `
Today is ${today}. Search the current public web for newly posted jobs that fit the candidate and the enabled categories below.

CANDIDATE PROFILE
${CONFIG.CANDIDATE_PROFILE}

SEARCH CATEGORIES
${categoryText}

SEARCH PREFERENCES
${preferenceText || '(none supplied)'}

RUNTIME LIMITS
- Prefer roles posted within the last ${settings.maxAgeDays} days.
- Minimum realistic match_score to include: ${settings.minMatchScore}.
- Set opportunity_type to "Job" for employment roles. Use "Freelance" only when the posting is clearly a freelance/project engagement.

MANDATORY RULES
1. ${buildGeographyRuleText_().replace(/\n/g, ' ')}
2. Prefer roles posted recently, but include an older role only when the fit is unusually strong and the page is still active.
3. Open and verify the direct job page before returning it. The page must represent one specific role and still accept applications.
4. Prefer the employer career site or an official ATS such as Greenhouse, Lever, Workday, Ashby or Comeet.
5. A generic LinkedIn/Indeed/AllJobs search-results page is not a verified job URL. Omit it.
6. Do not return research-only roles, internships, junior roles or entry-level PPC roles.
7. Use one of the supplied category names exactly in the category field.
8. Return at most ${CONFIG.MAX_RESULTS_PER_BATCH} total jobs, ranked by realistic fit and likelihood of interview.
9. Return Closed only when a specific job page was found but explicitly says it is expired, filled, removed or no longer accepting applications. Omit uncertain results.
10. Keep why_it_fits factual and concise. Do not invent salary, work mode, date or requirements. Use an empty string when unknown.
11. Set source_type to the platform family such as greenhouse, linkedin, comeet, company_careers.
12. Set confidence based on how well the public page evidence supports the fields.

FEW-SHOT EXAMPLES
- Official Greenhouse page for a named role, live Apply button, requirements match: status=Active and job_url is the Greenhouse role URL.
- LinkedIn URL ending in /jobs/search or an Indeed query-results page: omit entirely.
- Official role page saying "no longer accepting applications": status=Closed.
- "PPC Specialist, 1-2 years" when the config asks for senior leadership: omit.
`;

  const schema = buildOpportunitySchema_('jobs');
  const result = callOpenAI_(prompt, schema, 'job_search_results');
  return {
    opportunities: (result.jobs || []).map((item) => Object.assign({}, item, {
      opportunity_type: item.opportunity_type || CONFIG.OPPORTUNITY_TYPES.JOB,
      source_type: item.source_type || 'web',
    })),
    search_notes: result.search_notes || '',
    inaccessible_count: Number(result.inaccessible_count) || 0,
    meta: result._meta || {},
  };
}

/**
 * Scores listings that were already fetched, without browsing.
 *
 * Alert mail and aggregator APIs both hand us structured postings, so the expensive
 * web_search discovery pass buys nothing there — the facts are already in hand. Skipping
 * the tool removes its per-call fee and the retrieved page content that would otherwise
 * be re-sent on every later turn, which is what makes these channels cheap enough to
 * run on every pass.
 */

/**
 * @param listings  [{ url, title, sourceLabel, details }] — details is a short free-text line
 * @param options   { originDescription, schemaName, minMatchScore, evidenceNote }
 */
function scoreFetchedListings_(listings, categories, settings, options) {
  const config = options || {};
  const today = Utilities.formatDate(new Date(), CONFIG.TIME_ZONE, 'yyyy-MM-dd');
  const categoryText = categories
    .map((item) => `${item.category}: ${item.titles.join('; ')}`)
    .join('\n');
  const minScore = resolveListingMinScore_(settings, config.minMatchScore);

  const listingText = listings.map((listing, index) => {
    const lines = [`${index + 1}. [${listing.sourceLabel}] ${listing.title || '(no title supplied)'}`];
    lines.push(`   url: ${listing.url}`);
    if (cleanString_(listing.details)) lines.push(`   ${cleanString_(listing.details)}`);
    return lines.join('\n');
  }).join('\n');

  const prompt = `
Today is ${today}. Below are job postings collected from ${config.originDescription}.
They are already filtered by the source, so your job is to score fit against the candidate
and discard the ones that clearly do not suit them.

CANDIDATE PROFILE
${CONFIG.CANDIDATE_PROFILE}

CATEGORIES / TITLES
${categoryText}

${buildGeographyRuleText_()}

POSTINGS
${listingText}

MANDATORY
1. Do NOT browse. Judge only from the text above.
2. Copy job_url EXACTLY as given. Never edit, shorten or invent a URL.
3. Drop a posting clearly outside the candidate's fields or seniority.
4. Minimum match_score: ${minScore}. Omit anything below it.
5. Use one supplied category name exactly.
6. Only state company, location, salary or work mode when the text above says so.
   Use an empty string otherwise and never guess.
7. Set geo_eligibility to unknown unless the text states the location.
8. Set status to Active — these are current listings.
9. ${config.evidenceNote || 'Set confidence below 60 when the title alone is thin evidence.'}
10. Keep why_it_fits to the concrete overlap between the posting and the profile.
`;

  return callOpenAI_(
    prompt,
    buildOpportunitySchema_('opportunities'),
    config.schemaName || 'fetched_listing_results',
    [
      'You score already-collected job listings against a candidate profile.',
      'You have no browsing ability here — judge only from the supplied text.',
      'Never alter a supplied URL and never invent facts absent from the listing.',
      'Return only the requested structured JSON.',
    ].join(' '),
    { model: CONFIG.LISTING_SCORING_MODEL, useWebSearch: false }
  );
}

/**
 * These listings cleared the source's own filter already, so holding them to the full
 * web-discovery bar would throw away the channel's advantage. The sheet preference still
 * wins when the user has set it lower than the channel floor.
 */
function resolveListingMinScore_(settings, channelFloor) {
  const preference = Number(settings && settings.minMatchScore) || CONFIG.MIN_MATCH_SCORE_DEFAULT;
  const floor = Number(channelFloor) || preference;
  return Math.min(preference, floor);
}

/**
 * Keeps only listings whose URL we actually supplied, so a hallucinated or edited link
 * can never reach the sheet, and re-attaches the trusted fields from the fetch.
 */
function reconcileScoredListings_(scored, listings, decorate) {
  const byUrl = {};
  listings.forEach((listing) => { byUrl[listing.url] = listing; });

  return (scored.opportunities || [])
    .filter((item) => byUrl[cleanString_(item.job_url)])
    .map((item) => decorate(item, byUrl[cleanString_(item.job_url)]));
}

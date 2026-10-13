/**
 * Company board channel: fetch every roster board in one parallel round, keep the roles
 * that are actually in Israel and plausibly relevant, then score what survives.
 *
 * The filtering order is the point. A roster of ~17 companies returns several hundred
 * roles, most of them abroad or in unrelated functions. Discarding those with string
 * matching costs nothing, so only a few dozen roles ever reach the model.
 */

function searchAtsBoardsSource_(source, categories, settings) {
  const startedAt = Date.now();
  const fetched = fetchAtsBoards_(ATS_COMPANIES);

  const relevant = filterAtsRoles_(fetched.roles, categories)
    .slice(0, CONFIG.ATS.MAX_LISTINGS_PER_RUN);

  const fetchNote = `Read ${fetched.okBoards}/${ATS_COMPANIES.length} boards: `
    + `${fetched.roles.length} roles, ${relevant.length} in Israel and on-profile.`;

  if (!relevant.length) {
    return {
      opportunities: [],
      search_notes: joinNotes_(fetchNote, fetched.notes),
      inaccessible_count: fetched.failedBoards,
      miss_reasons: [],
      meta: { durationMs: Date.now() - startedAt },
    };
  }

  const listings = relevant.map((role) => ({
    url: role.url,
    title: role.title,
    sourceLabel: role.company,
    details: `company: ${role.company} | location: ${role.location}`
      + (role.posted ? ` | posted: ${role.posted}` : ''),
    company: role.company,
    location: role.location,
    posted: role.posted,
  }));

  const scored = scoreFetchedListings_(listings, categories, settings, {
    originDescription: 'the official careers boards of Israeli tech companies',
    schemaName: 'ats_board_results',
    minMatchScore: CONFIG.ATS.MIN_MATCH_SCORE,
    evidenceNote: 'The company, title and location are authoritative here, so confidence may reach 85.',
  });

  const opportunities = reconcileScoredListings_(scored, listings, (item, listing) => (
    Object.assign({}, item, {
      source: listing.company,
      source_type: source.source_id,
      source_id: source.source_id,
      opportunity_type: CONFIG.OPPORTUNITY_TYPES.JOB,
      // The board is the authority on these three, so never let a guess overwrite them.
      company: listing.company,
      location: listing.location,
      posted_date: listing.posted || cleanString_(item.posted_date),
    })
  ));

  return {
    opportunities,
    search_notes: joinNotes_(fetchNote, joinNotes_(fetched.notes, scored.search_notes || '')),
    inaccessible_count: fetched.failedBoards,
    miss_reasons: scored.miss_reasons || [],
    meta: scored._meta || { durationMs: Date.now() - startedAt },
  };
}

/**
 * One parallel round over the roster. fetchAll never throws for individual failures, so a
 * company that has left its ATS costs one dead response rather than the whole channel.
 */
function fetchAtsBoards_(companies) {
  const requests = companies.map((company) => ({
    url: ATS_PROVIDERS[company.provider].endpoint(company.slug),
    method: 'get',
    muteHttpExceptions: true,
    followRedirects: true,
    timeoutSeconds: CONFIG.ATS.TIMEOUT_SECONDS,
    headers: { Accept: 'application/json' },
  }));

  let responses = [];
  try {
    responses = UrlFetchApp.fetchAll(requests);
  } catch (error) {
    const reason = `ATS batch fetch failed: ${error}`;
    console.log(`Arrr, ${reason}`);
    return { roles: [], okBoards: 0, failedBoards: companies.length, notes: reason };
  }

  const roles = [];
  const failures = [];
  let okBoards = 0;

  companies.forEach((company, index) => {
    const parsed = parseAtsResponse_(company, responses[index]);
    if (!parsed.ok) {
      failures.push(`${company.label}: ${parsed.error}`);
      return;
    }
    okBoards += 1;
    parsed.roles.forEach((role) => roles.push(role));
  });

  if (failures.length) console.log(`Arrr, ${failures.length} ATS boards unreadable: ${failures.join('; ')}`);

  return {
    roles,
    okBoards,
    failedBoards: failures.length,
    notes: failures.length ? `Unreadable boards — ${failures.join('; ')}` : '',
  };
}

function parseAtsResponse_(company, response) {
  if (!response) return { ok: false, roles: [], error: 'no response' };

  try {
    const code = response.getResponseCode();
    if (code === 404) return { ok: false, roles: [], error: 'board not found (slug may have changed)' };
    if (code < 200 || code >= 300) return { ok: false, roles: [], error: `HTTP ${code}` };

    const provider = ATS_PROVIDERS[company.provider];
    const roles = provider.extract(JSON.parse(response.getContentText()))
      .filter((role) => role.title && /^https?:\/\//i.test(role.url))
      .map((role) => Object.assign({}, role, {
        company: company.label,
        board: provider.label,
      }));

    return { ok: true, roles, error: '' };
  } catch (error) {
    return { ok: false, roles: [], error: String(error) };
  }
}

/**
 * Israel first, then title relevance, newest first. Both checks are deliberately coarse:
 * they only need to remove the obvious misses cheaply, because the model still scores
 * whatever survives.
 */
function filterAtsRoles_(roles, categories) {
  const titlePattern = buildAtsTitlePattern_(categories);
  const seen = {};

  return roles
    .filter((role) => {
      if (seen[role.url]) return false;
      if (!isIsraeliAtsLocation_(role.location)) return false;
      if (titlePattern && !titlePattern.test(role.title)) return false;
      seen[role.url] = true;
      return true;
    })
    .sort((a, b) => String(b.posted || '').localeCompare(String(a.posted || '')));
}

/**
 * Reuses the commute and eligibility token lists that already decide location policy, so
 * there is one definition of "somewhere this candidate can work".
 */
function isIsraeliAtsLocation_(location) {
  const blob = cleanString_(location).toLowerCase();
  if (!blob) return false;
  if (locationHasAnyToken_(blob, CONFIG.COMMUTE_FAR_TOKENS)) return false;
  return locationHasAnyToken_(blob, CONFIG.COMMUTE_ALLOW_TOKENS)
    || locationHasAnyToken_(blob, CONFIG.ISRAEL_ELIGIBLE_TOKENS);
}

/**
 * A word-boundary match on the meaningful words of the configured job titles. Short words
 * are dropped because a two-letter fragment matches almost anything.
 */
function buildAtsTitlePattern_(categories) {
  const words = {};
  (categories || []).forEach((category) => {
    (category.titles || []).forEach((title) => {
      cleanString_(title).toLowerCase().split(/[^a-z0-9+#]+/).forEach((word) => {
        if (word.length >= 3) words[word] = true;
      });
    });
  });

  const list = Object.keys(words);
  if (!list.length) return null;

  const alternation = list.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(`(^|[^a-z0-9])(${alternation})([^a-z0-9]|$)`, 'i');
}

/**
 * Menu diagnostic: shows which boards answer and how many Israeli roles each has, so a
 * stale slug is visible before it quietly costs coverage.
 */
function checkAtsBoards() {
  const fetched = fetchAtsBoards_(ATS_COMPANIES);
  const byCompany = {};
  fetched.roles.forEach((role) => {
    if (!isIsraeliAtsLocation_(role.location)) return;
    byCompany[role.company] = (byCompany[role.company] || 0) + 1;
  });

  const israeliCount = Object.keys(byCompany).reduce((sum, key) => sum + byCompany[key], 0);
  const summary = `${fetched.okBoards}/${ATS_COMPANIES.length} boards answered — `
    + `${fetched.roles.length} roles total, ${israeliCount} in Israel.`;

  log_(fetched.failedBoards ? 'WARN' : 'INFO', `ATS board check — ${summary}`, JSON.stringify({
    israeliRolesByCompany: byCompany,
    unreadable: fetched.notes,
  }, null, 2));

  const ui = tryGetUi_();
  if (ui) ui.alert(`${summary}\n\n${JSON.stringify(byCompany, null, 2)}`);
}

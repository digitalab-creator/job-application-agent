/**
 * Location policy: remote must be open to Israel-based candidates; office/hybrid
 * must sit within ~1h of Petah Tikva.
 * Heuristic token match (no live Maps API) — single source of truth via CONFIG.
 */

function buildGeographyRuleText_() {
  return CONFIG.GEOGRAPHY_RULE;
}

function isRemoteFriendlyWorkMode_(workMode) {
  const value = cleanString_(workMode).toLowerCase();
  if (!value || value === 'not specified') return false;
  return /remote|work\s*from\s*home|wfh|מהבית|מרחוק|רימוט/.test(value)
    && !/hybrid|משרד|onsite|on-site|office only|office-only/.test(value);
}

function isHybridOrOnsiteWorkMode_(workMode) {
  const value = cleanString_(workMode).toLowerCase();
  if (!value || value === 'not specified') return true; // unknown → apply commute caution
  if (isRemoteFriendlyWorkMode_(value)) return false;
  return /hybrid|onsite|on-site|office|in[- ]office|משרד|היברידי|פרונטלי/.test(value)
    || !/remote|מהבית|מרחוק/.test(value);
}

function locationBlob_(location, workMode, notes, whyItFits) {
  return [location, workMode, notes, whyItFits].map(cleanString_).join(' ').toLowerCase();
}

function locationHasAnyToken_(blob, tokens) {
  return tokens.some((token) => blob.indexOf(String(token).toLowerCase()) !== -1);
}

/**
 * Whole-word matching for short/ambiguous tokens ("usa", "canada") so we do not
 * match them inside unrelated words. One compiled regex per token list, cached.
 */
const WORD_TOKEN_PATTERNS_ = {};

function locationHasAnyWord_(blob, tokens, cacheKey) {
  if (!WORD_TOKEN_PATTERNS_[cacheKey]) {
    const alternation = tokens
      .map((token) => String(token).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');
    WORD_TOKEN_PATTERNS_[cacheKey] = new RegExp(`(^|[^a-z0-9])(${alternation})([^a-z0-9]|$)`, 'i');
  }
  return WORD_TOKEN_PATTERNS_[cacheKey].test(blob);
}

/**
 * Remote is only useful when an Israel-based candidate may actually apply.
 * A remote role with no stated restriction is kept: absence of a restriction is
 * not evidence of one. Only explicit restriction evidence rejects, and it
 * outranks the model's own eligibility claim.
 *
 * @param blob full text (location, work mode, notes, why_it_fits) — restriction wording
 *   can appear anywhere, so restriction phrases are matched against all of it.
 * @param geoText location and work mode only — the fields that actually declare where
 *   a role is offered. Country names are matched here alone, so a US parent company
 *   mentioned in prose cannot sink an otherwise unrestricted remote role.
 */
function evaluateIsraelEligibility_(candidate, blob, geoText) {
  const declared = cleanString_(candidate.geo_eligibility).toLowerCase();

  if (declared === 'restricted_excludes_israel') {
    return { ok: false, reason: 'remote_not_israel_eligible' };
  }
  if (locationHasAnyToken_(blob, CONFIG.REMOTE_RESTRICTION_PHRASES)
    && !locationHasAnyToken_(blob, CONFIG.ISRAEL_ELIGIBLE_TOKENS)) {
    return { ok: false, reason: 'remote_not_israel_eligible' };
  }
  if (locationHasAnyToken_(blob, CONFIG.ISRAEL_ELIGIBLE_TOKENS)) {
    return { ok: true, reason: 'remote_israel_eligible' };
  }
  if (declared === 'worldwide'
    || declared === 'israel_eligible'
    || declared === 'no_restriction_stated') {
    return { ok: true, reason: 'remote_israel_eligible' };
  }
  if (locationHasAnyWord_(geoText, CONFIG.REMOTE_FOREIGN_LOCATION_TOKENS, 'foreign')) {
    return { ok: false, reason: 'remote_foreign_market' };
  }
  return { ok: true, reason: 'remote_eligibility_unknown' };
}

/**
 * Returns { ok: boolean, reason: string }
 */
function evaluateLocationPolicy_(candidate) {
  const location = cleanString_(candidate.location) || 'Not specified';
  const workMode = cleanString_(candidate.work_mode) || 'Not specified';
  const notes = cleanString_(candidate.notes);
  const blob = locationBlob_(location, workMode, notes, candidate.why_it_fits);

  // Fully remote — commute does not apply, but Israel eligibility still does.
  if (isRemoteFriendlyWorkMode_(workMode)) {
    return evaluateIsraelEligibility_(candidate, blob, locationBlob_(location, workMode));
  }

  // Explicit far office / relocation → reject.
  if (locationHasAnyToken_(blob, CONFIG.COMMUTE_FAR_TOKENS)) {
    return { ok: false, reason: 'outside_commute_area' };
  }

  // Hybrid/onsite with a known nearby city → accept.
  if (locationHasAnyToken_(blob, CONFIG.COMMUTE_ALLOW_TOKENS)) {
    return { ok: true, reason: 'within_commute_area' };
  }

  // Vague "Israel" / center without city: keep (LLM should prefer cities; don't over-drop).
  if (/israel|ישראל|nationwide|ארצי/.test(blob) && !locationHasAnyToken_(blob, CONFIG.COMMUTE_FAR_TOKENS)) {
    return { ok: true, reason: 'israel_vague_ok' };
  }

  // Unknown location + non-remote: keep but low trust; processor may still score.
  if (!location || location.toLowerCase() === 'not specified') {
    return { ok: true, reason: 'location_unknown_kept' };
  }

  // Named place we don't recognize as nearby and not remote → reject.
  if (isHybridOrOnsiteWorkMode_(workMode)) {
    return { ok: false, reason: 'outside_commute_area' };
  }

  return { ok: true, reason: 'default_ok' };
}

function passesLocationPolicy_(candidate) {
  return evaluateLocationPolicy_(candidate).ok;
}

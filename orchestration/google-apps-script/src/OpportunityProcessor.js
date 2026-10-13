/**
 * Normalize, score-filter, verify, dedupe and route opportunities.
 * Dedup: canonical URL + uniqueKey + content identity (URL-first; else company|role|location).
 */
function processCandidates_(candidates, existing, enabledCategories, settings, metrics) {
  const today = Utilities.formatDate(new Date(), CONFIG.TIME_ZONE, 'yyyy-MM-dd');
  const now = new Date();
  const allowedCategories = new Set(enabledCategories.map((item) => item.category));
  const jobActiveRows = [];
  const freelanceActiveRows = [];
  const closedRows = [];
  let skipped = 0;
  let urlChecksUsed = 0;
  const bySource = metrics.bySource || (metrics.bySource = {});

  const rejectionReasons = metrics.rejectionReasons || (metrics.rejectionReasons = {});

  function bumpSource(sourceId, field) {
    if (!sourceId) return;
    if (!bySource[sourceId]) {
      bySource[sourceId] = {
        candidates_raw: 0,
        llm_relevant: 0,
        duplicates: 0,
        inaccessible: 0,
      };
    }
    bySource[sourceId][field] = (bySource[sourceId][field] || 0) + 1;
  }

  function reject(reason, sourceId) {
    skipped += 1;
    rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1;
    if (reason === 'duplicate') bumpSource(sourceId, 'duplicates');
    if (reason === 'facebook_inaccessible') bumpSource(sourceId, 'inaccessible');
  }

  const sorted = (candidates || []).slice().sort((a, b) => {
    const preferA = isPreferredApplyUrl_(a.job_url) ? 1 : 0;
    const preferB = isPreferredApplyUrl_(b.job_url) ? 1 : 0;
    if (preferB !== preferA) return preferB - preferA;
    return Number(b.match_score || 0) - Number(a.match_score || 0);
  });

  sorted.forEach((candidate) => {
    const normalized = normalizeCandidate_(candidate, today);
    const sourceId = cleanString_(candidate.source_id || normalized.source_type);
    const sourceType = cleanString_(candidate.source_type || '');
    const isSocialFreelance = sourceType.indexOf('fb_') === 0
      || /facebook/i.test(sourceType)
      || normalized.opportunity_type === CONFIG.OPPORTUNITY_TYPES.FREELANCE;

    if (isSocialFreelance || candidate.force_freelance) {
      normalized.opportunity_type = CONFIG.OPPORTUNITY_TYPES.FREELANCE;
    } else {
      normalized.opportunity_type = classifyOpportunityType_(normalized);
    }

    // Social posts often have a person name or "Private client" instead of a brand.
    if (!normalized.company && normalized.opportunity_type === CONFIG.OPPORTUNITY_TYPES.FREELANCE) {
      normalized.company = 'Private client';
    }

    bumpSource(sourceId, 'candidates_raw');

    if (!normalized.role || !normalized.company || !normalized.job_url) {
      reject('missing_required_fields', sourceId);
      return;
    }
    if (!allowedCategories.has(normalized.category)) {
      reject('category_not_enabled', sourceId);
      return;
    }

    const isFreelance = normalized.opportunity_type === CONFIG.OPPORTUNITY_TYPES.FREELANCE;
    const effectiveMinScore = isFreelance
      ? Math.min(settings.minMatchScore, CONFIG.FREELANCE_MIN_MATCH_SCORE || 65)
      : settings.minMatchScore;
    if (normalized.match_score < effectiveMinScore) {
      reject('below_min_score', sourceId);
      return;
    }

    const salaryEstimate = estimateSalaryRange_(normalized);
    normalized.est_salary_range = salaryEstimate.display || '';
    if (!isFreelance) {
      const salaryFloor = evaluateSalaryFloor_(normalized.salary, normalized.est_salary_range);
      if (!salaryFloor.ok) {
        console.log(
          `Arrr, skipped below min salary (${salaryFloor.floor} ILS/mo): `
          + `${normalized.role} @ ${normalized.company} | listed=${normalized.salary} | est=${normalized.est_salary_range} | max~${salaryFloor.maxMonthlyIls} ILS/mo`
        );
        reject(salaryFloor.reason || 'below_min_salary', sourceId);
        return;
      }
    }

    const locationPolicy = evaluateLocationPolicy_(normalized);
    if (!locationPolicy.ok) {
      console.log(
        `Arrr, skipped on location policy (${locationPolicy.reason}): `
        + `${normalized.role} @ ${normalized.company} | ${normalized.location} | ${normalized.work_mode} `
        + `| geo_eligibility=${normalized.geo_eligibility}`
      );
      reject(locationPolicy.reason || 'outside_commute_area', sourceId);
      return;
    }

    const ageDays = daysBetween_(normalized.posted_date, now);
    const maxAge = isFreelance
      ? settings.maxAgeDays + (CONFIG.FREELANCE_EXTRA_AGE_DAYS || 0)
      : settings.maxAgeDays;
    const ageScoreFloor = isFreelance ? 75 : 90;
    if (ageDays !== null && ageDays > maxAge && normalized.match_score < ageScoreFloor) {
      reject('too_old', sourceId);
      return;
    }

    if (!isSpecificOpportunityUrl_(normalized.job_url, normalized.opportunity_type)) {
      console.log(`Arrr, skipped a generic or invalid URL: ${normalized.job_url}`);
      reject('generic_url', sourceId);
      return;
    }

    // A general web search will happily return a Facebook post, and nothing downstream
    // can ever prove that post is closed. Accept one only from a source chosen for that
    // platform; otherwise it becomes a row no evidence can remove.
    if (isUnverifiableUrl_(normalized.job_url) && !isFacebookSourceId_(sourceId)) {
      console.log(`Arrr, skipped an unverifiable ${getDomain_(normalized.job_url)} post from ${sourceId}: ${normalized.job_url}`);
      reject('unverifiable_url', sourceId);
      return;
    }

    const shouldVerify = urlChecksUsed < settings.maxUrlVerifications
      && !isUnverifiableUrl_(normalized.job_url)
      && !candidate.skip_url_verify;

    if (shouldVerify) {
      urlChecksUsed += 1;
      const urlInspection = inspectJobUrl_(normalized.job_url);
      if (urlInspection.definitelyClosed) {
        normalized.status = 'Closed';
        normalized.notes = joinNotes_(normalized.notes, urlInspection.reason);
      } else if (urlInspection.accessible === false && isFacebookSourceId_(sourceId)) {
        reject('facebook_inaccessible', sourceId);
        metrics.inaccessibleFacebook = (metrics.inaccessibleFacebook || 0) + 1;
        return;
      }
    }

    const uniqueKey = makeUniqueKey_(normalized.company, normalized.role, normalized.job_url);
    const normalizedUrl = normalizeUrl_(normalized.job_url);
    const contentIdentity = makeContentIdentity_(
      normalized.company,
      normalized.role,
      normalized.job_url,
      normalized.source_type,
      normalized.location
    );

    if (
      existing.keys.has(uniqueKey)
      || existing.urls.has(normalizedUrl)
      || existing.contentIds.has(contentIdentity)
    ) {
      reject('duplicate', sourceId);
      return;
    }

    normalized.notes = tagSourceId_(normalized.notes, sourceId || 'unknown');
    if (salaryEstimate.source && salaryEstimate.source !== 'Listed on posting') {
      normalized.notes = joinNotes_(normalized.notes, `salary_est=${salaryEstimate.source}`);
    }
    const row = candidateToRow_(normalized, uniqueKey);
    if (normalized.status === 'Active') {
      if (normalized.opportunity_type === CONFIG.OPPORTUNITY_TYPES.FREELANCE) {
        freelanceActiveRows.push(row);
      } else {
        jobActiveRows.push(row);
      }
      bumpSource(sourceId, 'llm_relevant');
    } else {
      closedRows.push(row);
      bumpSource(sourceId, 'llm_relevant');
    }

    existing.keys.add(uniqueKey);
    existing.urls.add(normalizedUrl);
    existing.contentIds.add(contentIdentity);
  });

  metrics.urlChecksUsed = urlChecksUsed;

  return {
    jobActiveRows,
    freelanceActiveRows,
    closedRows,
    skipped,
  };
}

function isPreferredApplyUrl_(url) {
  const value = cleanString_(url);
  return /greenhouse\.io|lever\.co|comeet\.com|ashbyhq\.com|workday\.com|myworkdayjobs\.com/i.test(value);
}

function normalizeCandidate_(candidate, today) {
  return {
    found_date: today,
    posted_date: cleanString_(candidate.posted_date),
    role: cleanString_(candidate.role),
    company: cleanString_(candidate.company),
    category: cleanString_(candidate.category),
    opportunity_type: cleanString_(candidate.opportunity_type),
    location: cleanString_(candidate.location) || 'Not specified',
    work_mode: cleanString_(candidate.work_mode) || 'Not specified',
    geo_eligibility: cleanString_(candidate.geo_eligibility) || 'unknown',
    salary: cleanString_(candidate.salary) || 'Not listed',
    est_salary_range: cleanString_(candidate.est_salary_range),
    match_score: clamp_(Math.round(Number(candidate.match_score) || 0), 0, 100),
    confidence: clamp_(Math.round(Number(candidate.confidence) || 0), 0, 100),
    why_it_fits: cleanString_(candidate.why_it_fits),
    source: cleanString_(candidate.source) || getDomain_(candidate.job_url),
    source_type: cleanString_(candidate.source_type || candidate.source_id) || 'web',
    job_url: cleanString_(candidate.job_url),
    status: candidate.status === 'Closed' ? 'Closed' : 'Active',
    notes: joinNotes_(
      cleanString_(candidate.notes),
      Number(candidate.confidence) ? `confidence=${clamp_(Math.round(Number(candidate.confidence)), 0, 100)}` : ''
    ),
  };
}

function candidateToRow_(job, uniqueKey) {
  return [
    uniqueKey,
    job.found_date,
    job.posted_date,
    job.role,
    job.company,
    job.category,
    job.location,
    job.work_mode,
    job.salary,
    job.est_salary_range || '',
    job.match_score,
    job.why_it_fits,
    job.source,
    job.job_url,
    job.status === 'Active' ? 'New' : 'Closed',
    '',
    job.notes,
  ];
}

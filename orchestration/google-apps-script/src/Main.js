/**
 * Main orchestrator: Sources scheduler → providers → dedupe → Jobs/Freelance.
 */
function runJobSearch() {
  runOpportunityPipeline_({ forceDryRun: false });
}

function runJobSearchDryRun() {
  runOpportunityPipeline_({ forceDryRun: true });
}

function refreshSourceRelevanceStats() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheets = getRequiredSheets_(ss);
  refreshUserRelevanceStats_(sheets.sources, sheets.jobs, sheets.freelance);
  log_('INFO', 'Refreshed per-source user relevance percentages. Arrr.', '');
}

function runOpportunityPipeline_(options) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10 * 1000)) {
    log_('WARN', 'Arrr, another run already holds the wheel. Skipping this run.', 'lock_busy');
    return;
  }

  const startedAt = new Date();
  const metrics = {
    rejectionReasons: {},
    inaccessibleFacebook: 0,
    apiCalls: 0,
    apiDurationMs: 0,
    usage: emptyUsage_(),
    bySource: {},
  };

  try {
    validateSettings_();

    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheets = getRequiredSheets_(ss);
    ensureLogSheet_(ss);
    maybeRunSalaryBackfillOnce_();

    const plan = readSearchConfig_(sheets.searchConfig);
    if (!plan.categories.length) {
      throw new Error('No enabled search categories were found in Search Config.');
    }

    const settings = Object.assign({}, plan.settings);
    if (options && options.forceDryRun) settings.dryRun = true;

    const movedClosed = settings.dryRun
      ? 0
      : recheckExistingJobs_(sheets.jobs, sheets.freelance, sheets.closed);

    const existing = readExistingIndex_(sheets.jobs, sheets.freelance, sheets.closed);

    const budget = openRunBudget_(settings, startedAt);
    if (budget.exhausted) {
      log_(
        'WARN',
        `Monthly LLM budget of ${budget.budgetIls} ILS is spent for ${budget.period}. Skipping searches this run.`,
        JSON.stringify(budgetReport_(budget, 0, 0))
      );
      return;
    }

    // Budget decides how many sources a run can afford; the sheet preference is the ceiling.
    const affordableCalls = affordableCallCount_(
      budget.runBudgetUsd,
      budget.avgCallCostUsd,
      settings.maxSourceCallsPerRun || CONFIG.MAX_SOURCE_CALLS_PER_RUN
    );
    if (affordableCalls < 1) {
      log_(
        'WARN',
        `Today's paced budget (${budget.runBudgetUsd} USD) does not cover one source call. Skipping searches.`,
        JSON.stringify(budgetReport_(budget, 0, 0))
      );
      return;
    }

    const budgetedSettings = Object.assign({}, settings, { maxSourceCallsPerRun: affordableCalls });
    const enabledSources = readEnabledSources_(sheets.sources, budgetedSettings);
    if (!enabledSources.length) {
      throw new Error('No enabled auto Sources found. Enable phase-1 rows on the Sources sheet.');
    }

    let candidates = [];
    let runSpendUsd = 0;
    let callsSkippedForBudget = 0;

    enabledSources.forEach((source) => {
      if (runSpendUsd >= budget.runBudgetUsd) {
        callsSkippedForBudget += 1;
        return;
      }
      console.log(`Arrr, source ${source.source_id} (${source.label})`);
      const result = runSourceProvider_(source, plan.categories, plan.preferences, settings);
      const meta = result.meta || {};
      const apiMs = Number(meta.durationMs || 0);
      metrics.apiCalls += 1;
      metrics.apiDurationMs += apiMs;
      metrics.usage = addUsage_(metrics.usage, meta.usage);
      metrics.model = meta.model || metrics.model;

      // Persist spend per call, so a mid-run failure cannot lose the accounting.
      const callCostUsd = Number(meta.estimatedCostUsd) || 0;
      if (callCostUsd > 0) {
        runSpendUsd += callCostUsd;
        recordBudgetSpend_(callCostUsd, new Date());
        // The average sizes the rotation, so only rotation calls may move it. Alert mail
        // costs a fraction of a web search and would otherwise flatter the estimate into
        // scheduling more searches than the budget covers.
        if (!isAlwaysOnSource_(source)) recordCallCostUsd_(callCostUsd);
      }

      if (result.search_notes) {
        log_('INFO', `${source.source_id} notes`, truncate_(result.search_notes, 1500));
      }
      if (result.miss_reasons && result.miss_reasons.length) {
        log_('INFO', `${source.source_id} miss_reasons`, result.miss_reasons.join(', '));
      }

      const tagged = (result.opportunities || []).map((item) => Object.assign({}, item, {
        source_id: source.source_id,
        source_type: item.source_type || source.source_id,
      }));
      candidates = candidates.concat(tagged);

      if (!metrics.bySource[source.source_id]) {
        metrics.bySource[source.source_id] = {
          candidates_raw: 0,
          llm_relevant: 0,
          duplicates: 0,
          inaccessible: 0,
        };
      }
      metrics.bySource[source.source_id].inaccessible += Number(result.inaccessible_count) || 0;
      metrics.bySource[source.source_id]._api_ms = apiMs;
      metrics.bySource[source.source_id]._cost_usd = Number(meta.estimatedCostUsd) || 0;
      metrics.bySource[source.source_id]._rowNumber = source.rowNumber;
      metrics.bySource[source.source_id]._sourceRef = source;
    });

    const processed = processCandidates_(
      candidates,
      existing,
      plan.categories,
      settings,
      metrics
    );

    Object.keys(metrics.bySource).forEach((sourceId) => {
      const stats = metrics.bySource[sourceId];
      const sourceRef = stats._sourceRef || enabledSources.find((s) => s.source_id === sourceId);
      if (!sourceRef || settings.dryRun) return;
      applySourceRunStats_(sheets.sources, sourceRef, {
        llm_relevant: stats.llm_relevant || 0,
        candidates_raw: stats.candidates_raw || 0,
        duplicates: stats.duplicates || 0,
        inaccessible: stats.inaccessible || 0,
        api_ms: stats._api_ms || 0,
      });
    });

    if (!settings.dryRun) {
      refreshUserRelevanceStats_(sheets.sources, sheets.jobs, sheets.freelance);
    }

    if (settings.dryRun) {
      log_(
        'INFO',
        `DRY RUN: would write ${processed.jobActiveRows.length} jobs, ${processed.freelanceActiveRows.length} freelance, ${processed.closedRows.length} closed.`,
        JSON.stringify({
          skipped: processed.skipped,
          rejectionReasons: metrics.rejectionReasons,
          bySource: summarizeBySource_(metrics.bySource),
          cost: summarizeRunCost_(metrics.usage, metrics.model || CONFIG.DEFAULT_MODEL),
          budget: budgetReport_(budget, runSpendUsd, callsSkippedForBudget),
          sampleJobs: processed.jobActiveRows.slice(0, 5).map((row) => ({
            role: row[CONFIG.COL_INDEX.ROLE],
            company: row[CONFIG.COL_INDEX.COMPANY],
            score: row[CONFIG.COL_INDEX.MATCH_SCORE],
            estSalary: row[CONFIG.COL_INDEX.EST_SALARY_RANGE],
            url: row[CONFIG.COL_INDEX.JOB_URL],
          })),
          sampleFreelance: processed.freelanceActiveRows.slice(0, 5).map((row) => ({
            role: row[CONFIG.COL_INDEX.ROLE],
            company: row[CONFIG.COL_INDEX.COMPANY],
            score: row[CONFIG.COL_INDEX.MATCH_SCORE],
            estSalary: row[CONFIG.COL_INDEX.EST_SALARY_RANGE],
            url: row[CONFIG.COL_INDEX.JOB_URL],
          })),
        })
      );
    } else {
      appendRows_(sheets.jobs, processed.jobActiveRows);
      appendRows_(sheets.freelance, processed.freelanceActiveRows);
      appendRows_(sheets.closed, processed.closedRows);
      SpreadsheetApp.flush();
      sendDigest_(
        processed.jobActiveRows,
        processed.freelanceActiveRows,
        sheets.jobs,
        sheets.freelance
      );
    }

    const elapsedSeconds = Math.round((new Date().getTime() - startedAt.getTime()) / 1000);
    log_(
      'INFO',
      `Run complete${settings.dryRun ? ' (dry run)' : ''}: ${processed.jobActiveRows.length} jobs, ${processed.freelanceActiveRows.length} freelance, ${processed.closedRows.length} closed, ${movedClosed} moved.`,
      JSON.stringify({
        skipped: processed.skipped,
        rejectionReasons: metrics.rejectionReasons,
        bySource: summarizeBySource_(metrics.bySource),
        urlChecksUsed: metrics.urlChecksUsed || 0,
        apiCalls: metrics.apiCalls,
        apiDurationMs: metrics.apiDurationMs,
        cost: summarizeRunCost_(metrics.usage, metrics.model || CONFIG.DEFAULT_MODEL),
        budget: budgetReport_(budget, runSpendUsd, callsSkippedForBudget),
        elapsedSeconds,
        dryRun: settings.dryRun,
        sourcesRun: enabledSources.map((s) => s.source_id),
      })
    );
  } catch (error) {
    const message = error && error.stack ? error.stack : String(error);
    log_('ERROR', 'Arrr, the opportunity-search run hit rough seas.', message);
    sendErrorEmail_(message);
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function summarizeBySource_(bySource) {
  const out = {};
  Object.keys(bySource || {}).forEach((id) => {
    const s = bySource[id];
    out[id] = {
      raw: s.candidates_raw || 0,
      llm_relevant: s.llm_relevant || 0,
      duplicates: s.duplicates || 0,
      inaccessible: s.inaccessible || 0,
      api_ms: s._api_ms || 0,
      cost_usd: s._cost_usd || 0,
    };
  });
  return out;
}

import path from "node:path";
import { getWorkspaceRuntime, resolveLedgerPath } from "../orchestration/workspace-runtime.js";
import { discoveryProgressPath, prepareDiscoveryScoringBatch } from "./scoring-progress.js";
import { budgetIsOpen, budgetSnapshot, recordPlatformAllocationIfNeeded } from "../budget/monthly-budget.js";
import { env } from "../config/env.js";
import { withJobCost } from "../llm/cost-ledger.js";
import { log } from "../logging/logger.js";
import {
  computeNewQueueStats,
  DAILY_APPLY_BATCH_LIMIT,
  DISCOVER_SKIP_NEW_MULTIPLIER,
  formatMixReport,
  rebalancePolicy,
  selectDiscoveryBatch,
  shouldSkipDiscoveryForQueueDepth,
  type NewQueueStats,
} from "./queue-mix.js";
import { marketingShareFromPolicy } from "../config/search-policy.js";
import { getSearchPolicy } from "../config/search-policy-runtime.js";
import {
  countUnresolvedSheetRows,
  shouldSkipDiscoveryForUnresolvedBacklog,
} from "../orchestration/sheet-backlog.js";
import type { JobSheetRow } from "../orchestration/sheets/job-sheet.js";
import { resolveDiscoveryBoardUrls } from "./resolve-discovery-boards.js";
import { fetchBoardJobs } from "./scan-boards.js";
import { prioritizeFreshOpeningsForScoring } from "./prioritize-fresh-openings.js";
import { scoreDiscoveryJobs, uniqueKeyForUrl } from "./score-jobs.js";
import {
  formatDiscoverySupplyFunnel,
  validateDiscoverySupply,
  type DiscoverySupplyFunnel,
} from "./validate-discovery-supply.js";

export type DiscoveryResult = {
  status: "ok" | "budget_reached" | "skipped";
  jobs: Array<{
    uniqueKey: string;
    role: string;
    company: string;
    url: string;
    matchScore: number;
    category: string;
    whyItFits: string;
    source: string;
    location: string;
    foundDate: string;
    sheetStatus: "New" | "Manual";
  }>;
  scannedBoards: number;
  supplyFunnel?: DiscoverySupplyFunnel;
  llmCostUsd: number;
  budget: ReturnType<typeof budgetSnapshot>;
  notes: string;
  mixReport?: string;
};

export async function runDiscovery(input: {
  /** Legacy URL list — merged into `existingPostingKeys` when provided. */
  existingUrls?: string[];
  /** Canonical posting keys already on the sheet (any blocking status). */
  existingPostingKeys?: Iterable<string>;
  newQueueStats?: NewQueueStats;
  boardUrls?: string[];
  sheetRows?: JobSheetRow[];
  /** Automatable employment rows in Status=New (supported ATS auto-apply). */
  actionableAutomatable?: number;
}): Promise<DiscoveryResult> {
  recordPlatformAllocationIfNeeded();
  const budget = budgetSnapshot();
  if (!budgetIsOpen()) {
    return {
      status: "budget_reached",
      jobs: [],
      scannedBoards: 0,
      llmCostUsd: 0,
      budget,
      notes: "Monthly budget exhausted. Discovery did not run.",
    };
  }
  const boards =
    input.boardUrls !== undefined && input.boardUrls.length === 0
      ? []
      : resolveDiscoveryBoardUrls({
        workspaceBoards: input.boardUrls,
        envBoardsCsv: process.env.JOB_DISCOVERY_BOARD_URLS,
        includeDefaultAtsBoards: true,
      });
  if (boards.length === 0) {
    return {
      status: "skipped",
      jobs: [],
      scannedBoards: 0,
      llmCostUsd: 0,
      budget: budgetSnapshot(),
      notes: "Set JOB_DISCOVERY_BOARD_URLS to Comeet board URLs (comma-separated).",
    };
  }
  const searchPolicy = getSearchPolicy();
  const queueStats = input.newQueueStats ?? {
    tech: 0,
    marketing: 0,
    total: 0,
    techPct: (1 - marketingShareFromPolicy(searchPolicy)) * 100,
  };
  if (!searchPolicy.discoverEnabled) {
    return {
      status: "skipped",
      jobs: [],
      scannedBoards: 0,
      llmCostUsd: 0,
      budget: budgetSnapshot(),
      notes: `discovery_skipped=search_config\ndiscover_enabled=false\npolicy_version=${searchPolicy.version}`,
    };
  }
  const applyBatchCap = DAILY_APPLY_BATCH_LIMIT;
  const unresolved = input.sheetRows ? countUnresolvedSheetRows(input.sheetRows) : 0;
  const actionableAutomatable = input.actionableAutomatable ?? 0;
  const pauseDiscoveryBacklog = shouldSkipDiscoveryForUnresolvedBacklog({
    unresolvedReviewManual: unresolved,
    actionableAutomatable,
    threshold: searchPolicy.skipDiscoverWhenUnresolvedGte,
    minActionableToPauseDiscovery: applyBatchCap,
  });
  if (pauseDiscoveryBacklog) {
    return {
      status: "skipped",
      jobs: [],
      scannedBoards: 0,
      llmCostUsd: 0,
      budget: budgetSnapshot(),
      notes: [
        "discovery_skipped=unresolved_backlog",
        `unresolved_review_manual=${unresolved}`,
        `actionable_automatable=${actionableAutomatable}`,
        `threshold=${searchPolicy.skipDiscoverWhenUnresolvedGte}`,
        `min_actionable_to_pause=${applyBatchCap}`,
        `policy_version=${searchPolicy.version}`,
        "Review/Manual backlog is high while actionable New supply is still sufficient — finish manual work before adding listings.",
      ].join("\n"),
    };
  }
  if (shouldSkipDiscoveryForQueueDepth(queueStats.statusNew, applyBatchCap)) {
    const threshold = applyBatchCap * DISCOVER_SKIP_NEW_MULTIPLIER;
    log("DISCOVERY_SKIPPED_QUEUE_DEPTH", {
      statusNew: queueStats.statusNew,
      dailyApplyBatchCap: applyBatchCap,
      threshold,
    });
    return {
      status: "skipped",
      jobs: [],
      scannedBoards: 0,
      llmCostUsd: 0,
      budget: budgetSnapshot(),
      notes: [
        `discovery_skipped=queue_depth`,
        `status_new=${queueStats.statusNew}`,
        `threshold=${threshold} (${DISCOVER_SKIP_NEW_MULTIPLIER}× daily batch cap ${applyBatchCap})`,
        "Sheet still has enough New rows — run apply, not discover.",
      ].join("\n"),
    };
  }
  const mixPolicy = rebalancePolicy(queueStats);
  log("DISCOVERY_MIX_POLICY", {
    searchPolicyVersion: searchPolicy.version,
    mode: mixPolicy.mode,
    techPct: mixPolicy.techPct,
    targetMktBatch: mixPolicy.targetMarketingShareOfBatch,
    discoveryMinScore: searchPolicy.discoveryMinMatchScore,
  });

  const existing = new Set<string>();
  for (const key of input.existingPostingKeys ?? []) {
    const normalized = String(key || "").trim();
    if (normalized) {
      existing.add(normalized);
    }
  }
  for (const url of input.existingUrls ?? []) {
    const key = uniqueKeyForUrl(url);
    if (key) {
      existing.add(key);
    }
  }
  const foundDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
  const tracked = await withJobCost("discovery://scan", async () => {
    const scoredCandidates: Awaited<ReturnType<typeof scoreDiscoveryJobs>>["jobs"] = [];
    let scanned = 0;
    let rawOpeningCount = 0;
    let freshOpeningCount = 0;
    let scoredInput = 0;
    let llmParseFailures = 0;
    let llmRejected = 0;
    let locationRejected = 0;
    const searchPolicyForRank = getSearchPolicy();
    for (const boardUrl of boards) {
      if (!budgetIsOpen()) {
        break;
      }
      scanned += 1;
      try {
        const openings = await fetchBoardJobs(boardUrl);
        log("DISCOVERY_BOARD_OPENINGS", { boardUrl, count: openings.length });
        rawOpeningCount += openings.length;
        const fresh = openings.filter((job) => !existing.has(uniqueKeyForUrl(job.href)));
        freshOpeningCount += fresh.length;
        if (fresh.length === 0) {
          continue;
        }
        const ranked = prioritizeFreshOpeningsForScoring(fresh, searchPolicyForRank);
        let progress: ReturnType<typeof prepareDiscoveryScoringBatch> | undefined;
        try {
          progress = prepareDiscoveryScoringBatch({
            ranked,
            limit: env.discoveryMaxJobsPerBoard,
            statePath: discoveryProgressPath(
              path.dirname(resolveLedgerPath(env.ledgerPath)),
              getWorkspaceRuntime()?.workspaceId ?? "internal",
              boardUrl,
            ),
            scope: JSON.stringify({
              version: searchPolicyForRank.version,
              rows: searchPolicyForRank.categoryRows,
              weights: [...searchPolicyForRank.categoryWeights],
              minScore: searchPolicyForRank.discoveryMinMatchScore,
              model: env.llmModel,
            }),
          });
        } catch (error) {
          log("DISCOVERY_PROGRESS_READ_FAILED", { boardUrl, message: `Arrr, scoring without progress: ${String(error)}` });
        }
        const capped = progress?.jobs ?? ranked.slice(0, env.discoveryMaxJobsPerBoard);
        scoredInput += capped.length;
        const scored = await scoreDiscoveryJobs(boardUrl, capped, mixPolicy.scoringBias);
        if (scored.stats.llmParseFailed) {
          llmParseFailures += 1;
        } else {
          try {
            progress?.commit();
          } catch (error) {
            log("DISCOVERY_PROGRESS_WRITE_FAILED", { boardUrl, message: `Arrr, keeping scored results: ${String(error)}` });
          }
        }
        llmRejected += scored.stats.llmRejected;
        locationRejected += scored.stats.locationRejected;
        for (const job of scored.jobs) {
          if (!existing.has(job.uniqueKey)) {
            scoredCandidates.push(job);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log("DISCOVERY_BOARD_FAILED", { boardUrl, message });
      }
    }
    const validated = await validateDiscoverySupply({
      rawOpeningCount,
      freshOpeningCount,
      scoreStats: {
        scoredInput,
        llmParseFailures,
        llmRejected,
        locationRejected,
      },
      scored: scoredCandidates,
      maxLivenessChecks: env.discoveryMaxJobsPerRun * 2,
    });
    const automatableCandidates = validated.jobs
      .filter((job) => job.sheetStatus === "New")
      .map((job) => ({
        uniqueKey: job.uniqueKey,
        role: job.role,
        company: job.company,
        url: job.url,
        matchScore: job.matchScore,
        category: job.category,
        whyItFits: job.whyItFits,
        source: job.source,
        location: job.location,
      }));
    const { selected, addedTech, addedMarketing } = selectDiscoveryBatch(
      automatableCandidates,
      mixPolicy,
      env.discoveryMaxJobsPerRun,
    );
    const selectedKeys = new Set(selected.map((job) => job.uniqueKey));
    const manualValidated = validated.jobs.filter(
      (job) => job.sheetStatus === "Manual" && !selectedKeys.has(job.uniqueKey),
    );
    const sheetJobs = [
      ...selected.map((job) => {
        const full = validated.jobs.find((row) => row.uniqueKey === job.uniqueKey);
        return {
          ...job,
          foundDate,
          sheetStatus: "New" as const,
          verifyEvidence: full?.verifyEvidence,
        };
      }),
      ...manualValidated.slice(0, Math.max(0, 5 - selected.length)).map((job) => ({
        uniqueKey: job.uniqueKey,
        role: job.role,
        company: job.company,
        url: job.url,
        matchScore: job.matchScore,
        category: job.category,
        whyItFits: job.whyItFits,
        source: job.source,
        location: job.location,
        foundDate,
        sheetStatus: "Manual" as const,
        verifyEvidence: job.verifyEvidence,
      })),
    ];
    for (const job of sheetJobs) {
      existing.add(job.uniqueKey);
    }
    return {
      jobs: sheetJobs,
      scanned,
      addedTech,
      addedMarketing,
      supplyFunnel: validated.funnel,
    };
  }, "discovery");

  const mixReport = formatMixReport({
    queue: queueStats,
    policy: mixPolicy,
    addedTech: tracked.result.addedTech,
    addedMarketing: tracked.result.addedMarketing,
  });

  return {
    status: "ok",
    jobs: tracked.result.jobs,
    scannedBoards: tracked.result.scanned,
    llmCostUsd: tracked.usd,
    budget: budgetSnapshot(),
    mixReport,
    supplyFunnel: tracked.result.supplyFunnel,
    notes: [
      `discovery_boards=${tracked.result.scanned}`,
      `discovery_added=${tracked.result.jobs.length}`,
      `llm_cost_usd=${tracked.usd}`,
      `monthly_budget_ils=${budgetSnapshot().spentIls}/${budgetSnapshot().limitIls}`,
      mixReport,
      tracked.result.supplyFunnel ? formatDiscoverySupplyFunnel(tracked.result.supplyFunnel) : "",
      "location_gate=remote_or_central_or_tel_aviv_district_israel",
    ].filter(Boolean).join("\n"),
  };
}

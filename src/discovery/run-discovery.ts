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
import { countUnresolvedSheetRows } from "../orchestration/sheet-backlog.js";
import type { JobSheetRow } from "../orchestration/sheets/job-sheet.js";
import { fetchBoardJobs } from "./scan-boards.js";
import { scoreDiscoveryJobs, uniqueKeyForUrl } from "./score-jobs.js";

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
  }>;
  scannedBoards: number;
  llmCostUsd: number;
  budget: ReturnType<typeof budgetSnapshot>;
  notes: string;
  mixReport?: string;
};

export async function runDiscovery(input: {
  existingUrls: string[];
  newQueueStats?: NewQueueStats;
  boardUrls?: string[];
  sheetRows?: JobSheetRow[];
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
  const boards = input.boardUrls?.length ? input.boardUrls : discoveryBoardUrls();
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
  const unresolved = input.sheetRows ? countUnresolvedSheetRows(input.sheetRows) : 0;
  if (unresolved >= searchPolicy.skipDiscoverWhenUnresolvedGte) {
    return {
      status: "skipped",
      jobs: [],
      scannedBoards: 0,
      llmCostUsd: 0,
      budget: budgetSnapshot(),
      notes: [
        "discovery_skipped=unresolved_backlog",
        `unresolved_review_manual=${unresolved}`,
        `threshold=${searchPolicy.skipDiscoverWhenUnresolvedGte}`,
        `policy_version=${searchPolicy.version}`,
        "Finish Review/Manual applications before adding listings.",
      ].join("\n"),
    };
  }
  const applyBatchCap = DAILY_APPLY_BATCH_LIMIT;
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

  const existing = new Set(
    input.existingUrls
      .map((url) => uniqueKeyForUrl(url))
      .filter(Boolean),
  );
  const foundDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
  const tracked = await withJobCost("discovery://scan", async () => {
    const candidates: Awaited<ReturnType<typeof scoreDiscoveryJobs>> = [];
    let scanned = 0;
    for (const boardUrl of boards) {
      if (!budgetIsOpen()) {
        break;
      }
      scanned += 1;
      try {
        const openings = await fetchBoardJobs(boardUrl);
        log("DISCOVERY_BOARD_OPENINGS", { boardUrl, count: openings.length });
        const fresh = openings.filter((job) => !existing.has(uniqueKeyForUrl(job.href)));
        if (fresh.length === 0) {
          continue;
        }
        const capped = fresh.slice(0, env.discoveryMaxJobsPerBoard);
        const scored = await scoreDiscoveryJobs(boardUrl, capped, mixPolicy.scoringBias);
        for (const job of scored) {
          if (!existing.has(job.uniqueKey)) {
            candidates.push(job);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log("DISCOVERY_BOARD_FAILED", { boardUrl, message });
      }
    }
    const { selected, addedTech, addedMarketing } = selectDiscoveryBatch(
      candidates,
      mixPolicy,
      env.discoveryMaxJobsPerRun,
    );
    for (const job of selected) {
      existing.add(job.uniqueKey);
    }
    const jobs = selected.map((job) => ({ ...job, foundDate }));
    return { jobs, scanned, addedTech, addedMarketing };
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
    notes: [
      `discovery_boards=${tracked.result.scanned}`,
      `discovery_added=${tracked.result.jobs.length}`,
      `llm_cost_usd=${tracked.usd}`,
      `monthly_budget_ils=${budgetSnapshot().spentIls}/${budgetSnapshot().limitIls}`,
      mixReport,
      "location_gate=remote_or_central_or_tel_aviv_district_israel",
    ].join("\n"),
  };
}

function discoveryBoardUrls(): string[] {
  const raw = process.env.JOB_DISCOVERY_BOARD_URLS?.trim() ?? "";
  if (!raw) {
    return [];
  }
  return raw
    .split(/[\n,]+/)
    .map((part) => part.trim())
    .filter((part) => /^https?:\/\//i.test(part));
}

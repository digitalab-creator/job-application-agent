import { budgetIsOpen, budgetSnapshot, recordPlatformAllocationIfNeeded } from "../budget/monthly-budget.js";
import { env } from "../config/env.js";
import { withJobCost } from "../llm/cost-ledger.js";
import { log } from "../logging/logger.js";
import {
  computeNewQueueStats,
  formatMixReport,
  rebalancePolicy,
  selectDiscoveryBatch,
  type NewQueueStats,
} from "./queue-mix.js";
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
  const boards = discoveryBoardUrls();
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
  const queueStats = input.newQueueStats ?? { tech: 0, marketing: 0, total: 0, techPct: 65 };
  const policy = rebalancePolicy(queueStats);
  log("DISCOVERY_MIX_POLICY", { mode: policy.mode, techPct: policy.techPct, targetMktBatch: policy.targetMarketingShareOfBatch });

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
        const scored = await scoreDiscoveryJobs(boardUrl, capped, policy.scoringBias);
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
      policy,
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
    policy,
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
      "location_gate=remote_or_central_district_israel",
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

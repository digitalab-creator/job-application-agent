import assert from "node:assert/strict";
import test from "node:test";
import {
  computeNewQueueStats,
  passesDiscoveryQuality,
  rebalancePolicy,
  selectDiscoveryBatch,
} from "./queue-mix.js";
import type { ScoredDiscoveryJob } from "./score-jobs.js";

function job(partial: Partial<ScoredDiscoveryJob> & Pick<ScoredDiscoveryJob, "category" | "matchScore">): ScoredDiscoveryJob {
  return {
    uniqueKey: "k",
    role: partial.role ?? "Role",
    company: "co",
    url: "https://example.com/jobs/x",
    whyItFits: partial.whyItFits ?? "fit",
    source: "n8n_discover",
    ...partial,
  };
}

test("heavy tech queue uses marketing-heavy batch target", () => {
  const policy = rebalancePolicy(computeNewQueueStats([
    { category: "Applied AI" },
    { category: "Applied AI" },
    { category: "Applied AI" },
    { category: "AI Product" },
    { category: "Growth Marketing" },
  ]));
  assert.equal(policy.mode, "heavy_tech");
  assert.equal(policy.targetMarketingShareOfBatch, 0.6);
});

test("tech-heavy policy blocks 80-score Applied AI but allows 90+", () => {
  const policy = rebalancePolicy({ tech: 90, marketing: 10, total: 100, techPct: 90 });
  assert.equal(passesDiscoveryQuality(job({ category: "Applied AI", matchScore: 80 }), policy), false);
  assert.equal(passesDiscoveryQuality(job({ category: "Applied AI", matchScore: 92 }), policy), true);
});

test("batch selection prioritizes marketing when rebalancing", () => {
  const policy = rebalancePolicy({ tech: 270, marketing: 30, total: 300, techPct: 90 });
  const candidates = [
    job({ category: "Applied AI", matchScore: 95, role: "AI Engineer Tel Aviv" }),
    job({ category: "Applied AI", matchScore: 88, role: "Backend Tel Aviv" }),
    job({ category: "Growth Marketing", matchScore: 70, role: "Growth Lead Israel" }),
    job({ category: "Performance Marketing Leadership", matchScore: 72, role: "PPC Lead TLV" }),
  ];
  const { selected, addedMarketing } = selectDiscoveryBatch(candidates, policy, 4);
  assert.ok(addedMarketing >= 2);
  assert.ok(selected.some((row) => row.category === "Growth Marketing"));
});

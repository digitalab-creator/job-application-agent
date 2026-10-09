import assert from "node:assert/strict";
import test from "node:test";
import {
  computeNewQueueStats,
  passesDiscoveryQuality,
  rebalancePolicy,
  selectApplyDailyBatch,
  selectDiscoveryBatch,
  shouldSkipDiscoveryForQueueDepth,
} from "./queue-mix.js";
import type { ScoredDiscoveryJob } from "./score-jobs.js";

function job(partial: Partial<ScoredDiscoveryJob> & Pick<ScoredDiscoveryJob, "category" | "matchScore">): ScoredDiscoveryJob {
  return {
    uniqueKey: "k",
    role: partial.role ?? "Engineer Tel Aviv",
    company: "co",
    url: "https://example.com/jobs/x",
    whyItFits: partial.whyItFits ?? "fit",
    source: "n8n_discover",
    location: "rules: metro:Tel Aviv",
    ...partial,
  };
}

test("heavy tech queue uses configured marketing share for discovery batch", () => {
  const policy = rebalancePolicy(computeNewQueueStats([
    { category: "Applied AI" },
    { category: "Applied AI" },
    { category: "Applied AI" },
    { category: "AI Product" },
    { category: "Growth Marketing" },
  ]));
  assert.equal(policy.mode, "heavy_tech");
  assert.equal(policy.targetMarketingShareOfBatch, 0.5);
});

test("tech-heavy policy blocks 80-score Applied AI but allows 90+", () => {
  const policy = rebalancePolicy({ tech: 90, marketing: 10, total: 100, techPct: 90 });
  assert.equal(passesDiscoveryQuality(job({ category: "Applied AI", matchScore: 80 }), policy), false);
  assert.equal(passesDiscoveryQuality(job({ category: "Applied AI", matchScore: 92 }), policy), true);
});

test("apply daily batch targets 50/50 tech and marketing by default", () => {
  type Row = { category: string; matchScore: number; url: string };
  const rows: Row[] = [];
  for (let i = 0; i < 20; i += 1) {
    rows.push({ category: "Applied AI", matchScore: 90 - i, url: `https://example.com/t${i}` });
  }
  for (let i = 0; i < 10; i += 1) {
    rows.push({ category: "Growth Marketing", matchScore: 80 - i, url: `https://example.com/m${i}` });
  }
  const { selected, pickedTech, pickedMarketing } = selectApplyDailyBatch(rows, (r) => r.matchScore);
  assert.equal(selected.length, 20);
  assert.equal(pickedTech, 10);
  assert.equal(pickedMarketing, 10);
});

test("batch selection prioritizes marketing when rebalancing", () => {
  const policy = rebalancePolicy({ tech: 270, marketing: 30, total: 300, techPct: 90 });
  const candidates = [
    job({ category: "Applied AI", matchScore: 95, role: "AI Engineer Tel Aviv" }),
    job({ category: "Applied AI", matchScore: 88, role: "Backend Tel Aviv" }),
    job({ category: "Growth Marketing", matchScore: 70, role: "Growth Lead Remote" }),
    job({ category: "Performance Marketing Leadership", matchScore: 72, role: "PPC Lead TLV" }),
  ];
  const { selected, addedMarketing } = selectDiscoveryBatch(candidates, policy, 4);
  assert.ok(addedMarketing >= 2);
  assert.ok(selected.some((row) => row.category === "Growth Marketing"));
});

test("skip discover when New rows exceed 3× daily apply limit", () => {
  assert.equal(shouldSkipDiscoveryForQueueDepth(61, 20), true);
  assert.equal(shouldSkipDiscoveryForQueueDepth(60, 20), false);
  assert.equal(shouldSkipDiscoveryForQueueDepth(undefined, 20), false);
});

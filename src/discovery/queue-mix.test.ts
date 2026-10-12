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
  assert.equal(policy.targetMarketingShareOfBatch, 0.80);
});

test("tech-heavy policy blocks 80-score Applied AI but allows 90+", () => {
  const policy = rebalancePolicy({ tech: 90, marketing: 10, total: 100, techPct: 90 });
  assert.equal(passesDiscoveryQuality(job({ category: "Applied AI", matchScore: 80 }), policy), false);
  assert.equal(passesDiscoveryQuality(job({ category: "Applied AI", matchScore: 92 }), policy), true);
});

test("apply daily batch targets tracker category mix for a full pool", () => {
  type Row = { category: string; matchScore: number; url: string };
  const rows: Row[] = [];
  const categories = [
    "Performance Marketing Leadership",
    "Revenue Systems",
    "Marketing Technology",
    "AI Solutions",
    "Applied AI",
    "Analytics & CRO",
  ];
  for (const category of categories) {
    for (let i = 0; i < 8; i += 1) {
      rows.push({
        category,
        matchScore: 90 - i,
        url: `https://example.com/${category.replace(/\s+/g, "-")}-${i}`,
      });
    }
  }
  const { selected, pickedTech, pickedMarketing } = selectApplyDailyBatch(rows, (r) => r.matchScore);
  assert.equal(selected.length, 20);
  const perf = selected.filter((r) => r.category === "Performance Marketing Leadership").length;
  const revenue = selected.filter((r) => r.category === "Revenue Systems").length;
  assert.equal(perf, 7);
  assert.equal(revenue, 5);
  assert.ok(pickedMarketing >= 10);
  assert.ok(pickedTech >= 5);
});

test("batch selection prioritizes marketing when rebalancing", () => {
  const policy = rebalancePolicy({ tech: 270, marketing: 30, total: 300, techPct: 90 });
  const candidates = [
    job({ category: "Applied AI", matchScore: 95, role: "AI Engineer Tel Aviv" }),
    job({ category: "Applied AI", matchScore: 88, role: "Backend Tel Aviv" }),
    job({ category: "Performance Marketing Leadership", matchScore: 70, role: "Growth Lead Remote" }),
    job({ category: "Performance Marketing Leadership", matchScore: 72, role: "PPC Lead TLV" }),
    job({ category: "Revenue Systems", matchScore: 71, role: "GTM Engineer TLV" }),
  ];
  const { selected, addedMarketing } = selectDiscoveryBatch(candidates, policy, 4);
  assert.ok(addedMarketing >= 2);
  assert.ok(selected.some((row) => row.category === "Performance Marketing Leadership"));
});

test("skip discover when New rows exceed 3× daily apply limit", () => {
  assert.equal(shouldSkipDiscoveryForQueueDepth(61, 20), true);
  assert.equal(shouldSkipDiscoveryForQueueDepth(60, 20), false);
  assert.equal(shouldSkipDiscoveryForQueueDepth(undefined, 20), false);
});

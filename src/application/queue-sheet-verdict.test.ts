import assert from "node:assert/strict";
import test from "node:test";
import {
  recommendQueueStatus,
  recommendStatusFromCapabilityOnly,
  sheetRowHasManualBlocker,
} from "./queue-sheet-verdict.js";

test("capability-only never assigns Manual", () => {
  assert.equal(recommendStatusFromCapabilityOnly("manual_only"), "Review");
  assert.equal(recommendStatusFromCapabilityOnly("resolvable"), "New");
  assert.equal(recommendStatusFromCapabilityOnly("invalid"), "Closed");
});

test("verified active automatable row returns to New", () => {
  const rec = recommendQueueStatus({
    currentStatus: "Manual",
    notes: "AUTO_CLASSIFY capability=resolvable → Manual",
    rawJobUrl: "https://boards.greenhouse.io/acme/jobs/123",
    role: "Growth Lead",
    capability: "resolvable",
    verifiedAt: "2026-10-10T12:00:00.000Z",
    liveness: {
      originalUrl: "https://boards.greenhouse.io/acme/jobs/123",
      finalUrl: "https://boards.greenhouse.io/acme/jobs/123",
      definitelyClosed: false,
      definitelyActive: true,
      unreachable: false,
      accessible: true,
      reason: "Posting page shows an active apply surface.",
    },
  });
  assert.equal(rec?.status, "New");
});

test("HTTP 200 without active proof stays Review", () => {
  const rec = recommendQueueStatus({
    currentStatus: "Manual",
    notes: "",
    rawJobUrl: "https://example.com/jobs/1",
    role: "Engineer",
    capability: "manual_only",
    verifiedAt: "2026-10-10T12:00:00.000Z",
    liveness: {
      originalUrl: "https://example.com/jobs/1",
      finalUrl: "https://example.com/jobs/1",
      definitelyClosed: false,
      definitelyActive: false,
      unreachable: false,
      accessible: false,
      reason: "HTTP 200 without proof the specific posting remains open.",
    },
  });
  assert.equal(rec?.status, "Review");
});

test("unreachable does not close; keeps Manual when blocker present", () => {
  assert.equal(sheetRowHasManualBlocker("result=manual_fill\nblocker=captcha"), true);
  const rec = recommendQueueStatus({
    currentStatus: "Manual",
    notes: "result=manual_fill\nblocker=captcha",
    rawJobUrl: "https://www.linkedin.com/jobs/view/123",
    role: "PM",
    capability: "manual_only",
    verifiedAt: "2026-10-10T12:00:00.000Z",
    liveness: {
      originalUrl: "https://www.linkedin.com/jobs/view/123",
      finalUrl: "https://www.linkedin.com/jobs/view/123",
      definitelyClosed: false,
      definitelyActive: false,
      unreachable: true,
      accessible: false,
      reason: "Timeout",
    },
  });
  assert.equal(rec?.status, "Manual");
});

test("Applied rows are never rewritten", () => {
  const rec = recommendQueueStatus({
    currentStatus: "Applied",
    notes: "",
    rawJobUrl: "https://example.com/jobs/1",
    role: "Engineer",
    capability: "supported_auto",
    verifiedAt: "2026-10-10T12:00:00.000Z",
    liveness: {
      originalUrl: "https://example.com/jobs/1",
      finalUrl: "https://example.com/jobs/1",
      definitelyClosed: true,
      definitelyActive: false,
      unreachable: false,
      accessible: false,
      reason: "closed",
    },
  });
  assert.equal(rec, null);
});

import assert from "node:assert/strict";
import test from "node:test";
import { decideOutcomeUpdate, outcomeStats, parseClassifiedOutcome, type ClassifiedOutcome } from "./email-outcomes.js";
import type { JobSheetRow } from "./sheets/job-sheet.js";

const rows: JobSheetRow[] = [
  {
    row_number: 4,
    Status: "Applied",
    Company: "Wix",
    Role: "Growth Engineer",
    Category: "Growth Engineering",
    "Applied Date": "2026-10-01",
    Notes: "",
  },
  {
    row_number: 5,
    Status: "Applied",
    Company: "Monday",
    Role: "Performance Lead",
    Category: "Growth Marketing",
    "Applied Date": "2026-10-02",
    Notes: "",
  },
];

function classified(partial: Partial<ClassifiedOutcome> & Pick<ClassifiedOutcome, "label">): ClassifiedOutcome {
  return { confidence: 0.95, company: "", role: "", nextStep: "", ...partial };
}

test("parser accepts only the closed outcome labels", () => {
  assert.equal(parseClassifiedOutcome({ label: "hired", confidence: 1 }), null);
  const parsed = parseClassifiedOutcome({
    label: "rejection",
    confidence: 0.91,
    company: "Wix",
    role: "Growth Engineer",
    nextStep: "",
  });
  assert.equal(parsed?.label, "rejection");
});

test("hebrew rejection updates the one matching applied row", () => {
  const decision = decideOutcomeUpdate(
    classified({ label: "rejection", company: "Wix", role: "Growth Engineer" }),
    rows,
    "לא התקבלת למשרה ב-Wix",
    "2026-10-10",
  );
  assert.equal(decision.kind, "update");
  if (decision.kind === "update") {
    assert.equal(decision.status, "Rejected");
    assert.equal(decision.rowNumber, 4);
    assert.match(decision.note, /2026-10-10 outcome: rejection/);
  }
});

test("english interview scheduling sets Interview", () => {
  const decision = decideOutcomeUpdate(
    classified({
      label: "interview_or_follow_up",
      company: "Monday",
      role: "Performance Lead",
      nextStep: "Please book a time for an interview",
    }),
    rows,
    "Next step: interview",
    "2026-10-11",
  );
  assert.equal(decision.kind, "update");
  if (decision.kind === "update") {
    assert.equal(decision.status, "Interview");
    assert.equal(decision.rowNumber, 5);
  }
});

test("hebrew interview phrase sets Interview", () => {
  const decision = decideOutcomeUpdate(
    classified({
      label: "interview_or_follow_up",
      company: "Monday",
      nextStep: "קביעת מועד לראיון עבודה",
    }),
    rows,
    "המשך תהליך",
    "2026-10-11",
  );
  assert.equal(decision.kind, "update");
  if (decision.kind === "update") {
    assert.equal(decision.status, "Interview");
  }
});

test("follow-up without an interview stays Follow-up", () => {
  const decision = decideOutcomeUpdate(
    classified({
      label: "interview_or_follow_up",
      company: "Wix",
      nextStep: "Can you send another work sample?",
    }),
    rows,
    "Quick question",
    "2026-10-11",
  );
  assert.equal(decision.kind, "update");
  if (decision.kind === "update") {
    assert.equal(decision.status, "Follow-up");
  }
});

test("low confidence and two company hits stay in review", () => {
  const low = decideOutcomeUpdate(
    classified({ label: "rejection", confidence: 0.4, company: "Wix" }),
    rows,
    "update",
    "2026-10-10",
  );
  assert.equal(low.kind, "review");
  const ambiguous = decideOutcomeUpdate(
    classified({ label: "rejection", company: "Wix" }),
    [...rows, { ...rows[0], row_number: 9, Company: "Wix" }],
    "update",
    "2026-10-10",
  );
  assert.equal(ambiguous.kind, "review");
  if (ambiguous.kind === "review") {
    assert.deepEqual(ambiguous.rowNumbers, [4, 9]);
  }
});

test("unrelated mail and unknown companies do not change a row", () => {
  const ignore = decideOutcomeUpdate(
    classified({ label: "ignore", company: "Newsletter" }),
    rows,
    "Weekly digest",
    "2026-10-10",
  );
  assert.equal(ignore.kind, "ignore");
  const missing = decideOutcomeUpdate(
    classified({ label: "rejection", company: "Not On Sheet" }),
    rows,
    "rejected",
    "2026-10-10",
  );
  assert.equal(missing.kind, "ignore");
});

test("outcome stats group rejection and interview by category", () => {
  const stats = outcomeStats([
    { ...rows[0], Status: "Rejected", Notes: "2026-10-08 outcome: rejection | no" },
    { ...rows[1], Status: "Interview", Notes: "2026-10-09 outcome: interview_or_follow_up | yes" },
  ]);
  const engineering = stats.byCategory.find((row) => row.category === "Growth Engineering");
  const marketing = stats.byCategory.find((row) => row.category === "Growth Marketing");
  assert.equal(engineering?.rejected, 1);
  assert.equal(engineering?.rejectionRate, 1);
  assert.equal(marketing?.advanced, 1);
  assert.equal(stats.medianDaysToOutcome, 7);
});

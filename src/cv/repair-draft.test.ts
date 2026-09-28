import assert from "node:assert/strict";
import test from "node:test";
import { repairCvDraft } from "./repair-draft.js";

test("null portfolioKey is removed so the schema can omit it", () => {
  const repaired = repairCvDraft({
    includePortfolio: false,
    portfolioKey: null,
    experience: [{ roleId: "caseedge", title: "Engineer", bullets: [] }],
  }) as { portfolioKey?: string; experience: Array<{ roleId: string }> };
  assert.equal("portfolioKey" in repaired, false);
  assert.equal(repaired.experience[0]?.roleId, "caseedge");
});

test("missing roleId is filled from the approved role order", () => {
  const repaired = repairCvDraft({
    experience: [
      { title: "A" },
      { title: "B" },
      { roleId: "  ", title: "C" },
    ],
  }) as { experience: Array<{ roleId?: string }> };
  assert.equal(repaired.experience[0]?.roleId, "caseedge");
  assert.equal(repaired.experience[1]?.roleId, "boroda");
  assert.equal(repaired.experience[2]?.roleId, "klogic");
});

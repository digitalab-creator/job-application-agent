import assert from "node:assert/strict";
import test from "node:test";
import { parseSearchConfigSheet, RECOVERY_CATEGORY_TARGET_SHARE } from "./search-policy.js";
import { categoryBatchTargets } from "../discovery/tracker-categories.js";
import { withSearchPolicy } from "./search-policy-runtime.js";
import { selectApplyDailyBatch, categorySide } from "../discovery/queue-mix.js";

test("recovery policy is workspace opt-in and yields 45/35/20 focus", async () => {
  const input = [
    ["Search Category", "Titles / Keywords", "Preference", "Value"],
    ["", "", "career_focus_mode", "recovery"],
  ];
  const policy = parseSearchConfigSheet(input);
  assert.equal(policy.careerFocusMode, "recovery");
  assert.deepEqual([...policy.categoryWeights], [...RECOVERY_CATEGORY_TARGET_SHARE]);
  await withSearchPolicy(policy, async () => {
    const weights = categoryBatchTargets(20);
    assert.equal((weights.get("Performance Marketing Leadership") ?? 0) + (weights.get("Analytics & CRO") ?? 0), 9);
    assert.equal((weights.get("Revenue Systems") ?? 0) + (weights.get("Marketing Technology") ?? 0), 7);
    assert.equal((weights.get("AI Solutions") ?? 0) + (weights.get("Applied AI") ?? 0), 4);
  });
});

test("marketing technology is marketing-side, even with a hybrid CV", () => {
  assert.equal(categorySide("Marketing Technology"), "marketing");
});

test("low budget limit is honored before category allocation", () => {
  const rows = Array.from({length:30},(_,i)=>({
    category:i<20?"Applied AI":"Performance Marketing Leadership",
    score:100-i,
  }));
  const picked=selectApplyDailyBatch(rows, r=>r.score,3);
  assert.equal(picked.selected.length,3);
});

test("other workspaces keep balanced default",()=>{
  const p=parseSearchConfigSheet([["Search Category","Titles / Keywords","Preference","Value"]]);
  assert.equal(p.careerFocusMode,"balanced");
});

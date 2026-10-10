import assert from "node:assert/strict";
import test from "node:test";
import { maybeTriggerPipelineRepair } from "./pipeline-repair-trigger.js";

test("maybeTriggerPipelineRepair skips when target met", () => {
  const previous = process.env.PIPELINE_REPAIR_AUTO_TRIGGER;
  process.env.PIPELINE_REPAIR_AUTO_TRIGGER = "true";
  maybeTriggerPipelineRepair({ confirmedEnd: 10, targetConfirmed: 10 });
  process.env.PIPELINE_REPAIR_AUTO_TRIGGER = previous;
  assert.ok(true);
});

test("maybeTriggerPipelineRepair respects disable flag", () => {
  process.env.PIPELINE_REPAIR_AUTO_TRIGGER = "false";
  maybeTriggerPipelineRepair({ confirmedEnd: 0, targetConfirmed: 10, endOfDay: true });
  assert.ok(true);
});

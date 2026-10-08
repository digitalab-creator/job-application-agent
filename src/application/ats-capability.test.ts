import assert from "node:assert/strict";
import test from "node:test";
import { resolveApplyCapability } from "./ats-capability.js";

test("Comeet and Greenhouse are supported_auto", () => {
  assert.equal(
    resolveApplyCapability("https://www.comeet.com/jobs/upwind/49.004/foo"),
    "supported_auto",
  );
  assert.equal(
    resolveApplyCapability("https://boards.greenhouse.io/acme/jobs/123"),
    "supported_auto",
  );
});

test("aggregators are manual_only", () => {
  assert.equal(resolveApplyCapability("https://www.linkedin.com/jobs/view/1"), "manual_only");
  assert.equal(resolveApplyCapability("https://www.drushim.co.il/job/1"), "manual_only");
});

test("malformed URLs are invalid", () => {
  assert.equal(resolveApplyCapability("not-a-url"), "invalid");
});

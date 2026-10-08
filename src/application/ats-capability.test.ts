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

test("job postings on aggregators are resolvable; search pages stay manual", () => {
  assert.equal(resolveApplyCapability("https://www.linkedin.com/jobs/view/4412564650"), "resolvable");
  assert.equal(resolveApplyCapability("https://www.drushim.co.il/job/38548191/"), "resolvable");
  assert.equal(
    resolveApplyCapability("https://www.gotfriends.co.il/jobslobby/ai/?page=1&total=11"),
    "manual_only",
  );
});

test("malformed URLs are invalid", () => {
  assert.equal(resolveApplyCapability("not-a-url"), "invalid");
});

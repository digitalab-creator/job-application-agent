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
  assert.equal(resolveApplyCapability("https://www.drushim.co.il/job/38548191/"), "resolvable");
  assert.equal(
    resolveApplyCapability("https://www.gotfriends.co.il/jobslobby/ai/?page=1&total=11"),
    "manual_only",
  );
});

test("LinkedIn stays manual until Easy Apply is explicitly enabled", () => {
  const previous = process.env.LINKEDIN_EASY_APPLY_ENABLED;
  delete process.env.LINKEDIN_EASY_APPLY_ENABLED;
  try {
    assert.equal(resolveApplyCapability("https://www.linkedin.com/jobs/view/4412564650"), "manual_only");
    process.env.LINKEDIN_EASY_APPLY_ENABLED = "true";
    assert.equal(resolveApplyCapability("https://www.linkedin.com/jobs/view/4412564650"), "resolvable");
    process.env.LINKEDIN_EASY_APPLY_ENABLED = "false";
    assert.equal(resolveApplyCapability("https://www.linkedin.com/jobs/view/4412564650"), "manual_only");
  } finally {
    if (previous === undefined) {
      delete process.env.LINKEDIN_EASY_APPLY_ENABLED;
    } else {
      process.env.LINKEDIN_EASY_APPLY_ENABLED = previous;
    }
  }
});

test("malformed URLs are invalid", () => {
  assert.equal(resolveApplyCapability("not-a-url"), "invalid");
});

import assert from "node:assert/strict";
import test from "node:test";
import { resolveGotFriendsScopeFromEvidence } from "./gotfriends.js";

test("SideCvForm evidence maps to agency_job_interest", () => {
  const scope = resolveGotFriendsScopeFromEvidence(
    {
      scope: "agency_job_interest",
      postingId: "151469",
      jobName: "151469",
      pageUrl: "/jobslobby/ai/llm-engineer/151469/",
      formId: "SideCvForm",
    },
    "https://www.gotfriends.co.il/jobslobby/ai/llm-engineer/151469/",
  );
  assert.equal(scope, "agency_job_interest");
});

test("CvFormGlobal empty job fields map to agency_registration", () => {
  const scope = resolveGotFriendsScopeFromEvidence(
    {
      scope: "agency_registration",
      postingId: null,
      jobName: null,
      pageUrl: "/jobslobby/ai/",
      formId: "CvFormGlobal",
    },
    "https://www.gotfriends.co.il/jobslobby/ai/",
  );
  assert.equal(scope, "agency_registration");
});

test("job-specific referral is not suppressed by registration dedup key alone", () => {
  const url = "https://www.gotfriends.co.il/jobslobby/ai/ai-engineer/154895/";
  const scope = resolveGotFriendsScopeFromEvidence(
    {
      scope: "agency_job_interest",
      postingId: "154895",
      jobName: "154895",
      pageUrl: "/jobslobby/ai/ai-engineer/154895/",
      formId: "SideCvForm",
    },
    url,
  );
  assert.equal(scope, "agency_job_interest");
});

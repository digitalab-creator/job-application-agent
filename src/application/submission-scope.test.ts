import assert from "node:assert/strict";
import test from "node:test";
import {
  gotFriendsPostingIdFromUrl,
  resolveIntendedScopeFromUrl,
  submissionDedupKey,
  countsAsConfirmedEmployerApplication,
} from "./submission-scope.js";

test("GotFriends job URLs resolve to agency_job_interest with posting id", () => {
  const url = "https://www.gotfriends.co.il/jobslobby/ai/ai-engineer/154895/";
  assert.equal(gotFriendsPostingIdFromUrl(url), "154895");
  assert.equal(resolveIntendedScopeFromUrl(url), "agency_job_interest");
});

test("GotFriends lobby URLs resolve to agency_registration", () => {
  const url = "https://www.gotfriends.co.il/jobslobby/ai/?page=1";
  assert.equal(resolveIntendedScopeFromUrl(url), "agency_registration");
});

test("dedup keys separate workspace, agency registration, and job interest", () => {
  const reg = submissionDedupKey({
    workspaceId: "internal",
    scope: "agency_registration",
    agencyId: "gotfriends.co.il",
  });
  const job = submissionDedupKey({
    workspaceId: "internal",
    scope: "agency_job_interest",
    agencyId: "gotfriends.co.il",
    postingId: "154895",
  });
  assert.notEqual(reg, job);
  assert.match(reg ?? "", /^agency_reg:internal:gotfriends\.co\.il$/);
  assert.match(job ?? "", /^agency_job:internal:gotfriends\.co\.il:154895$/);
});

test("only direct employer applications count toward employer quota", () => {
  assert.equal(countsAsConfirmedEmployerApplication("direct_employer_application"), true);
  assert.equal(countsAsConfirmedEmployerApplication("agency_registration"), false);
  assert.equal(countsAsConfirmedEmployerApplication("agency_job_interest"), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { candidate, withCandidateProfile } from "./candidate.js";
import { unitTestCandidateProfile } from "../test-fixtures/candidate-profile-fixture.js";
import { factById } from "../profile/facts.js";

test("candidate proxy uses fictional fixture only under NODE_ENV=test", () => {
  assert.equal(candidate.email, unitTestCandidateProfile.email);
});

test("a workspace profile replaces identity only inside the run", async () => {
  const buyer = {
    ...unitTestCandidateProfile,
    email: "buyer@example.com",
    fullName: "Buyer Example",
    media: {
      ...unitTestCandidateProfile.media,
      maxMonthlyBudgetIls: 250_000,
    },
  };
  await withCandidateProfile(unitTestCandidateProfile, async () => {
    assert.equal(candidate.email, unitTestCandidateProfile.email);
  });
  await withCandidateProfile(buyer, async () => {
    assert.equal(candidate.email, "buyer@example.com");
    assert.equal(candidate.fullName, "Buyer Example");
    assert.match(factById("summary-marketing")?.text ?? "", /250,000/);
    assert.match(factById("media-hands-on")?.text ?? "", /250000/);
  });
  assert.equal(candidate.email, unitTestCandidateProfile.email);
});

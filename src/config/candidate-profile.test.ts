import assert from "node:assert/strict";
import test from "node:test";
import { candidate, internalCandidateProfile, withCandidateProfile } from "./candidate.js";
import { factById } from "../profile/facts.js";

test("a workspace profile replaces identity only inside the run", async () => {
  const buyer = {
    ...internalCandidateProfile,
    email: "buyer@example.com",
    fullName: "Buyer Example",
    media: {
      ...internalCandidateProfile.media,
      maxMonthlyBudgetIls: 250_000,
    },
  };
  assert.equal(candidate.email, internalCandidateProfile.email);
  await withCandidateProfile(buyer, async () => {
    assert.equal(candidate.email, "buyer@example.com");
    assert.equal(candidate.fullName, "Buyer Example");
    assert.match(factById("summary-marketing")?.text ?? "", /250,000/);
    assert.match(factById("media-hands-on")?.text ?? "", /250000/);
  });
  assert.equal(candidate.email, internalCandidateProfile.email);
  assert.match(factById("summary-marketing")?.text ?? "", /500,000/);
});

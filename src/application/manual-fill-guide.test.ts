import assert from "node:assert/strict";
import test from "node:test";
import { runWithCandidateProfile } from "../config/candidate.js";
import { unitTestCandidateProfile } from "../test-fixtures/candidate-profile-fixture.js";
import { buildSheetManualNotes, shouldPromoteToManualSheet } from "./manual-fill-guide.js";

test("manual sheet notes include apply embed, cv, and profile fields", () => {
  runWithCandidateProfile(unitTestCandidateProfile, () => {
  const notes = buildSheetManualNotes({
    applyUrl: "https://job-boards.greenhouse.io/similarweb/jobs/8239378",
    blocker: "captcha",
    cvDownloadUrl: "https://example.com/cv.pdf",
    answers: [],
  });
  assert.match(notes, /embed\/job_app\?for=similarweb&token=8239378/);
  assert.match(notes, /cv=https:\/\/example.com\/cv.pdf/);
  assert.match(notes, /candidate\.fixture@example\.com/);
  assert.doesNotMatch(notes, /console/i);
  });
});

test("form_validation with CV promotes to manual sheet", () => {
  assert.equal(
    shouldPromoteToManualSheet({
      status: "review",
      blocker: "form_validation",
      cvPath: "/app/generated-cv/x.pdf",
    }),
    true,
  );
});

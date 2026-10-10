import assert from "node:assert/strict";
import test from "node:test";
import { classifyRedirectTarget, isHubOrRootUrl } from "./link-liveness.js";

test("redirect to careers hub is closed", () => {
  const reason = classifyRedirectTarget(
    "https://acme.com/job/123456",
    "https://acme.com/careers",
  );
  assert.match(reason ?? "", /hub or site root/i);
});

test("redirect away from numeric posting id is closed", () => {
  const reason = classifyRedirectTarget(
    "https://boards.greenhouse.io/acme/jobs/5471204",
    "https://acme.com/careers",
  );
  assert.ok(reason);
});

test("hub path detection", () => {
  assert.equal(isHubOrRootUrl("https://acme.com/careers"), true);
  assert.equal(isHubOrRootUrl("https://acme.com/jobs/12345"), false);
});

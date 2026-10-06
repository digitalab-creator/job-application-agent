import assert from "node:assert/strict";
import test from "node:test";
import { hostDoesNotExist, isNameNotResolvedError } from "./dead-host.js";

test("only the name-not-resolved browser error counts as a dead-host signal", () => {
  assert.equal(isNameNotResolvedError("page.goto: net::ERR_NAME_NOT_RESOLVED at https://x.invalid/"), true);
  assert.equal(isNameNotResolvedError("page.goto: net::ERR_CONNECTION_TIMED_OUT at https://x.com/"), false);
  assert.equal(isNameNotResolvedError("page.goto: net::ERR_INTERNET_DISCONNECTED"), false);
});

test("hostDoesNotExist is true for a guaranteed-NXDOMAIN host and false for garbage input", async () => {
  // .invalid is reserved by RFC 2606 and can never resolve.
  assert.equal(await hostDoesNotExist("https://careers.example.invalid/jobs/1"), true);
  assert.equal(await hostDoesNotExist("not a url"), false);
});

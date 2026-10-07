import assert from "node:assert/strict";
import test from "node:test";
import { fitLocationRejection } from "./fit-location-guard.js";

test("model-stated foreign location is rejected", () => {
  assert.equal(fitLocationRejection({ location: "New York, USA", workMode: "onsite" }, "Growth Manager"), "foreign_only");
});

test("model-stated other Israeli region is rejected", () => {
  assert.equal(fitLocationRejection({ location: "Haifa, Israel", workMode: "onsite" }, "Growth Manager"), "other_israel_region");
});

test("Tel Aviv, plain Israel, remote and unknown all continue", () => {
  assert.equal(fitLocationRejection({ location: "Tel Aviv, Israel", workMode: "hybrid" }, "Growth Manager"), null);
  assert.equal(fitLocationRejection({ location: "Israel", workMode: "unknown" }, "Growth Manager"), null);
  assert.equal(fitLocationRejection({ location: "Remote", workMode: "remote" }, "Growth Manager"), null);
  assert.equal(fitLocationRejection({ location: "unknown", workMode: "unknown" }, "Growth Manager"), null);
  assert.equal(fitLocationRejection({ location: "Global", workMode: "unknown" }, "Growth Manager"), null);
});

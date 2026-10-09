import assert from "node:assert/strict";
import test from "node:test";
import { opportunityKindFromRow } from "./opportunity-kind.js";

test("freelance_project from explicit column", () => {
  assert.equal(
    opportunityKindFromRow({ "Opportunity Kind": "freelance_project", Source: "Comeet" }),
    "freelance_project",
  );
});

test("employment by default", () => {
  assert.equal(opportunityKindFromRow({ Source: "Comeet", Category: "Applied AI" }), "employment");
});

test("freelance from XPlace source", () => {
  assert.equal(opportunityKindFromRow({ Source: "XPlace", Category: "Freelance Project" }), "freelance_project");
});

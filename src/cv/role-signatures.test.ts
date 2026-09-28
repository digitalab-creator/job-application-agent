import assert from "node:assert/strict";
import test from "node:test";
import { roleSignatureErrors } from "./role-signatures.js";

test("ROI Me bullet cannot sit under CaseEdge", () => {
  const errors = roleSignatureErrors(
    "caseedge",
    "Architected ROI Me / Budget Watch with 20 microservices.",
    "CaseEdge bullet 1",
  );
  assert.ok(errors.length > 0);
});

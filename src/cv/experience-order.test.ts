import assert from "node:assert/strict";
import test from "node:test";
import { buildVerbatim } from "./verbatim.js";

test("verbatim experience lists K Logic before Boroda Kaplan", () => {
  const doc = buildVerbatim("technical");
  const companies = doc.experience.map((role) => role.roleId);
  const boroda = companies.indexOf("boroda");
  const klogic = companies.indexOf("klogic");
  assert.ok(boroda >= 0 && klogic >= 0);
  assert.ok(klogic < boroda, companies.join(","));
});

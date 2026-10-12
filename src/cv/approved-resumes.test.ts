import assert from "node:assert/strict";
import test from "node:test";
import { roles, HEADLINES, facts } from "../profile/facts.js";
import { buildVerbatim } from "./verbatim.js";
import { renderCvHtml } from "./template.js";
import { validateCv } from "./validate.js";

test("career chronology matches current approved manual resumes", () => {
  assert.deepEqual(roles.map(r=>r.id), ["caseedge","klogic","boroda","fullpower","independent"]);
  assert.equal(roles.find(r=>r.id==="boroda")?.end,"Dec 2024");
  assert.equal(roles.find(r=>r.id==="caseedge")?.start,"Oct 2025");
  assert.equal(roles.find(r=>r.id==="klogic")?.start,"Apr 2025");
});

test("marketing and technical outputs have one clear leading identity", () => {
  const tech=buildVerbatim("technical"), marketing=buildVerbatim("marketing");
  assert.equal(tech.headlineId,"tech-full");
  assert.equal(marketing.headlineId,"marketing-full");
  assert.match(HEADLINES["tech-full"],/Applied AI/);
  assert.match(HEADLINES["marketing-full"],/Performance Marketing/);
  assert.match(renderCvHtml(tech,"technical"),/<h2>CaseEdge<\/h2>/);
  assert.match(renderCvHtml(marketing,"marketing"),/<h2>Digitalab<\/h2>/);
  assert.equal(validateCv(tech,"technical").ok,true);
  assert.equal(validateCv(marketing,"marketing").ok,true);
});

test("entity matching and AI cost improvement only belong to CaseEdge facts", () => {
  const matching=facts.filter(f=>/entity-matching accuracy from approximately 70% to 95%/.test(f.text));
  assert.ok(matching.length>0);
  assert.ok(matching.every(f=>f.roleId==="caseedge"));
});

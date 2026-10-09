import assert from "node:assert/strict";
import test from "node:test";
import { suggestedPersonaForTrackerCategory } from "../discovery/tracker-categories.js";
import { choosePersonaFromText } from "./persona-from-text.js";

test("a performance manager title stays marketing when the ad also mentions LLM tools", () => {
  const persona = choosePersonaFromText(
    "Senior Performance Manager",
    "marketing",
    "Lead PPC on Google and Meta. Use AI/LLM tools such as Claude and Cursor.",
  );
  assert.equal(persona, "marketing");
});

test("representative roles do not default unrelated operations work to technical", () => {
  assert.equal(choosePersonaFromText("Applied AI Engineer", "", "Python, RAG, APIs"), "technical");
  assert.equal(choosePersonaFromText("Backend Engineer", "", "Production services and microservices"), "technical");
  assert.equal(choosePersonaFromText("Solutions Engineer", "", "Customer-facing architecture and technical discovery"), "hybrid");
  assert.equal(choosePersonaFromText("Product Manager", "", "Own roadmap, APIs, experimentation, and technical requirements"), "hybrid");
  assert.equal(choosePersonaFromText("Growth Manager", "", "Paid acquisition, CRO, and campaign strategy"), "marketing");
  assert.equal(choosePersonaFromText("Performance Marketing Manager", "", "Google Ads, budgets, and ROAS"), "marketing");
  assert.equal(choosePersonaFromText("Marketing Operations", "", "Automation, APIs, data workflows, and campaign operations"), "hybrid");
  assert.equal(choosePersonaFromText("RevOps Manager", "", "CRM, attribution, automation, and revenue process"), "hybrid");
  assert.equal(choosePersonaFromText("Growth Engineer", "", "APIs, experimentation, acquisition, and analytics"), "hybrid");
  assert.equal(choosePersonaFromText("Martech Lead", "", "Marketing technology and automation"), "hybrid");
  assert.equal(choosePersonaFromText("Operations Manager", "", "Facilities, scheduling, and office administration"), null);
});

test("tracker sheet categories align with CV persona defaults", () => {
  assert.equal(
    choosePersonaFromText("GTM Engineer", "Revenue Systems", "CRM integrations, APIs, webhooks, automation, attribution"),
    suggestedPersonaForTrackerCategory("Revenue Systems"),
  );
  assert.equal(
    choosePersonaFromText("Senior Performance Manager", "Performance Marketing Leadership", "Google Ads, Meta, budgets"),
    suggestedPersonaForTrackerCategory("Performance Marketing Leadership"),
  );
});

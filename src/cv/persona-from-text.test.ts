import assert from "node:assert/strict";
import test from "node:test";
import { choosePersonaFromText } from "./persona-from-text.js";

test("a performance manager title stays marketing when the ad also mentions LLM tools", () => {
  const persona = choosePersonaFromText(
    "Senior Performance Manager",
    "marketing",
    "Lead PPC on Google and Meta. Use AI/LLM tools such as Claude and Cursor.",
  );
  assert.equal(persona, "marketing");
});

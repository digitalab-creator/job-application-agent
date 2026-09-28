import assert from "node:assert/strict";
import test from "node:test";
import { polishCvText } from "./prose.js";

test("polish fixes collapsed business-domain after line break", () => {
  const out = polishCvText("11+ years of businessdomain expertise");
  assert.match(out, /business.domain/i);
  assert.doesNotMatch(out, /businessdomain/i);
});

test("polish normalizes end to end", () => {
  assert.match(polishCvText("systems end to end"), /end.to.end/i);
});

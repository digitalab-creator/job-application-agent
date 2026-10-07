import assert from "node:assert/strict";
import test from "node:test";
import { countryCodeValue, israelPhoneCountryOption } from "./phone-country-code.js";

test("finds Israel option by country code or name", () => {
  assert.equal(israelPhoneCountryOption(["Select", "+972 (Israel)", "+1 (US)"]), "+972 (Israel)");
  assert.equal(israelPhoneCountryOption(["United States", "Israel", "United Kingdom"]), "Israel");
});

test("returns the safe prefix when the form is a text field", () => {
  assert.equal(countryCodeValue([]), "+972");
});

test("never uses the complete candidate phone number", () => {
  assert.notEqual(countryCodeValue(["+1 (US)", "+44 (UK)"]), "+972502186338");
  assert.equal(israelPhoneCountryOption(["+1 (US)", "+44 (UK)"]), null);
});

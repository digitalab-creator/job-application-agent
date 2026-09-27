import assert from "node:assert/strict";
import test from "node:test";
import { costUsd } from "./prices.js";

test("sol cost uses fresh input, cached input, and output rates", () => {
  const usd = costUsd("gpt-5.6-sol", { promptTokens: 1_000_000, cachedTokens: 250_000, completionTokens: 1_000_000 });
  assert.equal(usd, 23.1);
});

test("a short terra call is a fraction of a cent", () => {
  const usd = costUsd("gpt-5.6-terra", { promptTokens: 1000, cachedTokens: 0, completionTokens: 200 });
  assert.equal(usd, 0.0044);
});

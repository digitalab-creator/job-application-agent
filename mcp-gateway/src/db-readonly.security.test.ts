import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

test("readonly SQL definitions are SELECT-only", () => {
  const src = fs.readFileSync(path.join(root, "../src/db-readonly.ts"), "utf8");
  const queriesBlock = src.match(/const QUERIES = \{([\s\S]*?)\} as const/)?.[1] ?? "";
  const sqlSnippets = [...queriesBlock.matchAll(/`([\s\S]*?)`/g)].map((match) => match[1]!.trim());
  assert.ok(sqlSnippets.length > 0);
  for (const sql of sqlSnippets) {
    assert.match(sql, /^SELECT\b/i, `expected SELECT-only query, got: ${sql.slice(0, 40)}`);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/i);
  }
});

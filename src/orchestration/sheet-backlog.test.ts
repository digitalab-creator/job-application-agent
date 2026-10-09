import assert from "node:assert/strict";
import test from "node:test";
import { countUnresolvedSheetRows } from "./sheet-backlog.js";

test("unresolved backlog counts Review and Manual only", () => {
  const n = countUnresolvedSheetRows([
    { Status: "Review" },
    { Status: "Manual" },
    { Status: "New" },
    { Status: "Applied" },
  ]);
  assert.equal(n, 2);
});

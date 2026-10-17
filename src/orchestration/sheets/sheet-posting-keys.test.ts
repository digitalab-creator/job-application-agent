import assert from "node:assert/strict";
import test from "node:test";
import {
  filterRowsForSheetAppend,
  postingKeysFromSheetRows,
} from "./sheet-posting-keys.js";

test("Not Relevant Yotpo row blocks rediscovery by canonical key", () => {
  const keys = postingKeysFromSheetRows([
    {
      Status: "Not Relevant",
      "Job URL": "https://www.yotpo.com/careers/gid-8211515/",
      "Unique Key": "legacy-host-key",
    },
  ]);
  assert.equal(keys.has("greenhouse:yotpo:8211515"), true);
});

test("append filter drops rows whose posting key already exists", () => {
  const existing = new Set(["greenhouse:yotpo:7633905"]);
  const rows = filterRowsForSheetAppend([
    {
      "Unique Key": "greenhouse:yotpo:7633905",
      "Job URL": "https://boards.greenhouse.io/yotpo/jobs/7633905",
      Role: "Duplicate",
    },
    {
      "Unique Key": "greenhouse:taboola:999",
      "Job URL": "https://boards.greenhouse.io/taboola/jobs/999",
      Role: "Fresh",
    },
  ], existing);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.Role, "Fresh");
});

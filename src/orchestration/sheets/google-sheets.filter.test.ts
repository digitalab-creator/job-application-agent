import assert from "node:assert/strict";
import test from "node:test";
import { clearBasicFiltersOnSheets } from "./google-sheets.js";

test("clearBasicFiltersOnSheets clears only matching sheets that have a basic filter", async () => {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? String(init.body) : undefined });
    if (url.includes(":batchUpdate")) {
      return new Response(JSON.stringify({}), { status: 200 });
    }
    return new Response(
      JSON.stringify({
        sheets: [
          { properties: { sheetId: 111, title: "Jobs" }, basicFilter: { range: {} } },
          { properties: { sheetId: 222, title: "Other" } },
        ],
      }),
      { status: 200 },
    );
  };

  try {
    const cleared = await clearBasicFiltersOnSheets("token", "spreadsheet-id", [111, 222]);
    const metaGet = calls.find((c) => c.method === "GET" && !c.url.includes(":batchUpdate"));
    assert.ok(metaGet);
    assert.ok(
      metaGet!.url.includes("fields=sheets(properties(sheetId,title),basicFilter)"),
      `unexpected metadata fields mask: ${metaGet!.url}`,
    );
    assert.deepEqual(cleared, [111]);
    const batch = calls.find((c) => c.url.includes(":batchUpdate"));
    assert.ok(batch);
    const body = JSON.parse(batch!.body ?? "{}") as { requests: unknown[] };
    assert.equal(body.requests.length, 1);
    assert.deepEqual(body.requests[0], { clearBasicFilter: { sheetId: 111 } });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { discoveryProgressPath, prepareDiscoveryScoringBatch } from "./scoring-progress.js";

function fixture(t: { after: (fn: () => void) => void }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "discovery-progress-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ranked = Array.from({ length: 29 }, (_, i) => ({
    href: "https://example.com/jobs/" + i, title: "Engineer " + i, snippet: "Tel Aviv",
  }));
  return { ranked, limit: 12, scope: "policy-v1", statePath: path.join(dir, "progress.json") };
}

test("Arrr, unchanged rejects cannot starve listings beyond the first scoring cap", (t) => {
  const input = fixture(t);
  const examined = new Set<string>();
  for (let i = 0; i < 3; i++) {
    const batch = prepareDiscoveryScoringBatch(input);
    assert.equal(batch.jobs.length, 12);
    batch.jobs.forEach(job => examined.add(job.href));
    batch.commit();
  }
  assert.equal(examined.size, 29);
});

test("Arrr, scoring failure leaves the same batch available", (t) => {
  const input = fixture(t);
  const first = prepareDiscoveryScoringBatch(input);
  assert.deepEqual(prepareDiscoveryScoringBatch(input).jobs, first.jobs);
  assert.equal(fs.existsSync(input.statePath), false);
});

test("Arrr, new and changed listings go ahead of previously scored listings", (t) => {
  const input = fixture(t);
  prepareDiscoveryScoringBatch(input).commit();
  input.ranked[0] = { ...input.ranked[0]!, snippet: "Updated requirements" };
  const jobs = prepareDiscoveryScoringBatch(input).jobs;
  assert.equal(jobs[0]?.href, input.ranked[0]?.href);
  assert.equal(jobs[1]?.href, input.ranked[12]?.href);
});

test("Arrr, policy changes restart ranking and workspace paths stay separate", (t) => {
  const input = fixture(t);
  const first = prepareDiscoveryScoringBatch(input);
  first.commit();
  assert.deepEqual(prepareDiscoveryScoringBatch({ ...input, scope: "policy-v2" }).jobs, first.jobs);
  assert.notEqual(discoveryProgressPath("/tmp", "a", "board"), discoveryProgressPath("/tmp", "b", "board"));
  assert.notEqual(discoveryProgressPath("/tmp", "a", "board"), discoveryProgressPath("/tmp", "a", "other"));
});

test("Arrr, removed listings are pruned and duplicate URLs consume one slot", (t) => {
  const input = fixture(t);
  prepareDiscoveryScoringBatch(input).commit();
  const ranked = [input.ranked[20]!, input.ranked[20]!];
  const batch = prepareDiscoveryScoringBatch({ ...input, ranked });
  assert.equal(batch.jobs.length, 1);
  batch.commit();
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(input.statePath, "utf8")).seen).length, 1);
});

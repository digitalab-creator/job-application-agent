import assert from "node:assert/strict";
import test from "node:test";
import type { DailyPipelineResult } from "./daily-pipeline.js";
import { runStartupApplyCatchUp } from "./scheduler-catch-up.js";
import { internalCandidateProfile } from "../config/candidate.js";
import type { WorkspaceRecord } from "./workspace-types.js";

function workspace(id: string, lastApplyRunKey: string | null): WorkspaceRecord {
  return {
    id,
    displayName: id,
    timezone: "Asia/Jerusalem",
    schedule: { discoverHour: 8, applyHour: 9, outcomeHour: 18 },
    enabled: true,
    spreadsheetId: "sheet",
    jobsSheetGid: "0",
    excludeCompaniesSheetName: "Exclude Companies",
    discoveryBoardUrls: [],
    monthlyBudgetIls: 500,
    applyTechTarget: 10,
    applyMarketingTarget: 10,
    notificationTarget: "",
    runTokenHash: "hash",
    googleRefreshTokenEnc: null,
    mailboxRefreshTokenEnc: null,
    mailboxEmail: null,
    greenhouseOtpWebhookUrl: null,
    browserUserDataDir: null,
    ledgerPath: null,
    applyAttemptsPath: null,
    profile: internalCandidateProfile,
    lastDiscoverRunKey: null,
    lastApplyRunKey,
    lastOutcomeRunKey: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

test("runStartupApplyCatchUp runs pipeline only for missed apply slots", async () => {
  const calls: string[] = [];
  const mockPipeline = async (input: { workspace: WorkspaceRecord }): Promise<DailyPipelineResult> => {
    calls.push(input.workspace.id);
    return {
      status: "ok",
      confirmedStart: 0,
      confirmedEnd: 0,
      targetConfirmed: 10,
      discoverRuns: 0,
      applyRuns: 1,
      notes: "mock",
    };
  };
  const afternoonJerusalem = new Date("2026-10-14T13:22:00+03:00");
  await runStartupApplyCatchUp(
    [
      workspace("missed", null),
      workspace("done", "apply:2026-10-14:9"),
    ],
    mockPipeline,
    afternoonJerusalem,
  );
  assert.deepEqual(calls, ["missed"]);
});

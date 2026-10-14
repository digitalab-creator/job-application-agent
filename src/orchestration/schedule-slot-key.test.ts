import assert from "node:assert/strict";
import test from "node:test";
import {
  shouldCatchUpApplySlot,
  shouldMarkWorkspaceScheduleComplete,
  workspaceScheduleSlotKey,
} from "./schedule-slot-key.js";
import { internalCandidateProfile } from "../config/candidate.js";
import type { WorkspaceRecord } from "./workspace-types.js";

function workspace(overrides: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
  return {
    id: "internal",
    displayName: "Internal",
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
    lastApplyRunKey: null,
    lastOutcomeRunKey: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("workspaceScheduleSlotKey uses configured apply hour after restart", () => {
  const ws = workspace();
  const afternoon = new Date("2026-10-14T10:22:00+03:00");
  assert.equal(workspaceScheduleSlotKey(ws, "apply", afternoon), "apply:2026-10-14:9");
});

test("shouldCatchUpApplySlot when container starts after 09:00", () => {
  const ws = workspace({ lastApplyRunKey: null });
  const now = { date: "2026-10-14", hour: 13 };
  assert.equal(shouldCatchUpApplySlot(ws, now), true);
});

test("shouldCatchUpApplySlot false when today's apply slot already completed", () => {
  const ws = workspace({ lastApplyRunKey: "apply:2026-10-14:9" });
  const now = { date: "2026-10-14", hour: 13 };
  assert.equal(shouldCatchUpApplySlot(ws, now), false);
});

test("shouldMarkWorkspaceScheduleComplete distinguishes success from failure", () => {
  assert.equal(shouldMarkWorkspaceScheduleComplete("ok"), true);
  assert.equal(shouldMarkWorkspaceScheduleComplete("skipped"), true);
  assert.equal(shouldMarkWorkspaceScheduleComplete("error"), false);
  assert.equal(shouldMarkWorkspaceScheduleComplete("locked"), false);
});

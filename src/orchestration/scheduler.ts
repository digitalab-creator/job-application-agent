import { log } from "../logging/logger.js";
import { orchestrationMode } from "../config/env.js";
import { ensureWorkspaceSchema, workspaceDatabaseUrl } from "./db.js";
import { runWorkspaceApplyDaily } from "./apply-daily.js";
import { runWorkspaceDiscoverDaily } from "./discover-daily.js";
import { listEnabledWorkspaces } from "./workspace-store.js";

const DEBOUNCE_MS = 2 * 60 * 1000;
const POLL_MS = 60_000;

let timer: NodeJS.Timeout | null = null;
const lastTriggered = new Map<string, number>();

export async function startNativeScheduler(): Promise<void> {
  if (orchestrationMode() !== "native") {
    return;
  }
  if (!workspaceDatabaseUrl()) {
    log("NATIVE_SCHEDULER_SKIPPED", { reason: "no WORKSPACE_DATABASE_URL" });
    return;
  }
  await ensureWorkspaceSchema();
  if (timer) {
    return;
  }
  log("NATIVE_SCHEDULER_STARTED", { pollMs: POLL_MS });
  timer = setInterval(() => {
    void tickScheduledWorkspaces().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      log("NATIVE_SCHEDULER_TICK_FAILED", { message });
    });
  }, POLL_MS);
}

export async function tickScheduledWorkspaces(): Promise<void> {
  const workspaces = await listEnabledWorkspaces();
  for (const workspace of workspaces) {
    const now = localParts(workspace.timezone);
    const runKey = `${now.date}:${now.hour}`;
    if (now.hour === workspace.schedule.discoverHour) {
      await maybeRun(workspace.id, `discover:${runKey}`, async () => {
        await runWorkspaceDiscoverDaily({
          workspace,
          runSource: "native_schedule",
          dryRun: false,
        });
      });
    }
    if (now.hour === workspace.schedule.applyHour) {
      await maybeRun(workspace.id, `apply:${runKey}`, async () => {
        await runWorkspaceApplyDaily({
          workspace,
          runSource: "native_schedule",
          submit: true,
          dryRun: false,
        });
      });
    }
  }
}

async function maybeRun(workspaceId: string, key: string, fn: () => Promise<void>): Promise<void> {
  const composite = `${workspaceId}:${key}`;
  const prev = lastTriggered.get(composite) ?? 0;
  if (Date.now() - prev < DEBOUNCE_MS) {
    return;
  }
  lastTriggered.set(composite, Date.now());
  await fn();
}

function localParts(timeZone: string): { date: string; hour: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const bag: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      bag[part.type] = part.value;
    }
  }
  const date = `${bag.year}-${bag.month}-${bag.day}`;
  const hour = Number(bag.hour);
  return { date, hour: Number.isFinite(hour) ? hour : -1 };
}

import { spawn } from "node:child_process";
import path from "node:path";
import { log } from "../logging/logger.js";

const REPO_ROOT = path.resolve(process.cwd());

/** Fire-and-forget evaluation for autonomous pipeline repair (bounded in Python). */
export function maybeTriggerPipelineRepair(input: {
  endOfDay?: boolean;
  confirmedEnd: number;
  targetConfirmed: number;
}): void {
  if (process.env.PIPELINE_REPAIR_AUTO_TRIGGER === "false") {
    return;
  }
  if (input.confirmedEnd >= input.targetConfirmed) {
    return;
  }
  const script = path.join(REPO_ROOT, "scripts", "maybe-trigger-pipeline-repair.py");
  const args = ["python3", script, "--spawn"];
  if (input.endOfDay) {
    args.push("--end-of-day");
  }
  try {
    const child = spawn(args[0], args.slice(1), {
      cwd: REPO_ROOT,
      stdio: "ignore",
      detached: true,
    });
    child.unref();
    log("PIPELINE_REPAIR_TRIGGER_SPAWNED", {
      endOfDay: Boolean(input.endOfDay),
      confirmedEnd: input.confirmedEnd,
      targetConfirmed: input.targetConfirmed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("PIPELINE_REPAIR_TRIGGER_FAILED", { message });
  }
}

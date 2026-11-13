import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

type Opening = { href: string; title: string; snippet: string };
type Progress = { scope: string; sequence: number; seen: Record<string, number> };

function fingerprint(job: Opening): string {
  return createHash("sha256").update(JSON.stringify([job.href, job.title, job.snippet])).digest("hex");
}

export function discoveryProgressPath(directory: string, workspaceId: string, boardUrl: string): string {
  const key = createHash("sha256").update(JSON.stringify([workspaceId, boardUrl])).digest("hex");
  return path.join(directory, "discovery-progress", key + ".json");
}

// Arrr, keep the scoring cap, but give unseen and least-recently scored cargo a turn.
export function prepareDiscoveryScoringBatch<T extends Opening>(input: {
  ranked: T[];
  limit: number;
  statePath: string;
  scope: string;
}): { jobs: T[]; commit: () => void } {
  let progress: Progress = { scope: input.scope, sequence: 0, seen: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(input.statePath, "utf8")) as Progress;
    if (parsed.scope === input.scope && Number.isSafeInteger(parsed.sequence) && parsed.sequence >= 0
      && parsed.seen && typeof parsed.seen === "object" && !Array.isArray(parsed.seen)) {
      progress = parsed;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  const seen = (key: string): number => {
    const value = progress.seen[key];
    return Number.isSafeInteger(value) && value > 0 && value <= progress.sequence ? value : 0;
  };
  const unique = new Map<string, T>();
  for (const job of input.ranked) {
    if (!unique.has(job.href)) unique.set(job.href, job);
  }
  const ranked = [...unique.values()].map((job, rank) => ({ job, rank, key: fingerprint(job) }));
  ranked.sort((a, b) => seen(a.key) - seen(b.key) || a.rank - b.rank);
  const limit = Number.isFinite(input.limit) ? Math.max(0, Math.floor(input.limit)) : 0;
  const selected = ranked.slice(0, limit);
  return {
    jobs: selected.map(({ job }) => job),
    // Arrr, advance only after scoring succeeds; a failed call must not bury a listing.
    commit: () => {
      const sequence = progress.sequence + 1;
      const nextSeen: Record<string, number> = {};
      for (const { key } of ranked) {
        if (seen(key)) nextSeen[key] = seen(key);
      }
      for (const { key } of selected) nextSeen[key] = sequence;
      // Arrr, prune vanished listings and cap persistent bookkeeping.
      const entries = Object.entries(nextSeen).sort((a, b) => b[1] - a[1]).slice(0, 10000);
      const next: Progress = { scope: input.scope, sequence, seen: Object.fromEntries(entries) };
      fs.mkdirSync(path.dirname(input.statePath), { recursive: true });
      const temporary = input.statePath + "." + randomUUID() + ".tmp";
      try {
        fs.writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 });
        fs.renameSync(temporary, input.statePath);
      } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      }
    },
  };
}

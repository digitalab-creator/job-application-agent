import fs from "node:fs";
import path from "node:path";
import { log } from "../logging/logger.js";

export type CaptchaSolverProvider = "buster" | "2captcha";

export type CaptchaSolverLaneStats = {
  attempts: number;
  successes: number;
  failures: number;
};

export type CaptchaApplyStats = {
  /** Apply runs on a page that had any captcha widget (passive or active). */
  attempts: number;
  /** Confirmed application on those sites (your success bar). */
  confirmed: number;
  confirmedAfterBuster: number;
  confirmedAfter2Captcha: number;
  confirmedPassiveOnly: number;
};

export type CaptchaSolverStatsStore = {
  activeChallenges: number;
  buster: CaptchaSolverLaneStats;
  twoCaptcha: CaptchaSolverLaneStats;
  applyOnCaptchaSite: CaptchaApplyStats;
  lastSuccessProvider?: CaptchaSolverProvider;
  lastSuccessAt?: string;
  lastApplyConfirmedAt?: string;
  updatedAt: string;
};

export type CaptchaSolverStatsSnapshot = CaptchaSolverStatsStore & {
  successRate: {
    buster: number | null;
    twoCaptcha: number | null;
  };
};

function storePath(): string {
  return process.env.CAPTCHA_SOLVER_STATS_PATH?.trim() || "/app/data/ledger/captcha-solver-stats.json";
}

function emptyLane(): CaptchaSolverLaneStats {
  return { attempts: 0, successes: 0, failures: 0 };
}

function emptyApplyStats(): CaptchaApplyStats {
  return {
    attempts: 0,
    confirmed: 0,
    confirmedAfterBuster: 0,
    confirmedAfter2Captcha: 0,
    confirmedPassiveOnly: 0,
  };
}

function emptyStore(): CaptchaSolverStatsStore {
  return {
    activeChallenges: 0,
    buster: emptyLane(),
    twoCaptcha: emptyLane(),
    applyOnCaptchaSite: emptyApplyStats(),
    updatedAt: new Date().toISOString(),
  };
}

function readStore(): CaptchaSolverStatsStore {
  const file = storePath();
  try {
    if (!fs.existsSync(file)) {
      return emptyStore();
    }
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as CaptchaSolverStatsStore;
    return {
      ...emptyStore(),
      ...parsed,
      buster: { ...emptyLane(), ...parsed.buster },
      twoCaptcha: { ...emptyLane(), ...parsed.twoCaptcha },
      applyOnCaptchaSite: { ...emptyApplyStats(), ...parsed.applyOnCaptchaSite },
    };
  } catch (error) {
    log("CAPTCHA_SOLVER_STATS_READ_FAILED", {
      message: error instanceof Error ? error.message : "read_failed",
    });
    return emptyStore();
  }
}

function writeStore(store: CaptchaSolverStatsStore): void {
  const file = storePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(store, null, 2));
}

function laneKey(provider: CaptchaSolverProvider): "buster" | "twoCaptcha" {
  return provider === "buster" ? "buster" : "twoCaptcha";
}

function successRate(lane: CaptchaSolverLaneStats): number | null {
  if (lane.attempts === 0) {
    return null;
  }
  return Math.round((lane.successes / lane.attempts) * 1000) / 10;
}

export function captchaSolverStatsSnapshot(): CaptchaSolverStatsSnapshot {
  const store = readStore();
  return {
    ...store,
    successRate: {
      buster: successRate(store.buster),
      twoCaptcha: successRate(store.twoCaptcha),
    },
  };
}

/** An active reCAPTCHA challenge triggered the solver chain. */
export function noteActiveCaptchaChallenge(): void {
  const store = readStore();
  store.activeChallenges += 1;
  store.updatedAt = new Date().toISOString();
  writeStore(store);
}

export function noteCaptchaSolverAttempt(provider: CaptchaSolverProvider): void {
  const store = readStore();
  const lane = store[laneKey(provider)];
  lane.attempts += 1;
  store.updatedAt = new Date().toISOString();
  writeStore(store);
  log("CAPTCHA_SOLVER_ATTEMPT", { provider, attempts: lane.attempts });
}

export function noteCaptchaSolverOutcome(
  provider: CaptchaSolverProvider,
  ok: boolean,
  reason?: string,
): void {
  const store = readStore();
  const lane = store[laneKey(provider)];
  if (ok) {
    lane.successes += 1;
    store.lastSuccessProvider = provider;
    store.lastSuccessAt = new Date().toISOString();
    log("CAPTCHA_SOLVER_SUCCESS_COUNTED", {
      provider,
      successes: lane.successes,
      attempts: lane.attempts,
    });
  } else {
    lane.failures += 1;
    log("CAPTCHA_SOLVER_FAILURE_COUNTED", {
      provider,
      failures: lane.failures,
      attempts: lane.attempts,
      reason: reason?.slice(0, 200),
    });
  }
  store.updatedAt = new Date().toISOString();
  writeStore(store);
}

/** Page had a captcha widget during an apply run (passive or active). */
export function noteCaptchaSiteApplyAttempt(): void {
  const store = readStore();
  store.applyOnCaptchaSite.attempts += 1;
  store.updatedAt = new Date().toISOString();
  writeStore(store);
  log("CAPTCHA_SITE_APPLY_ATTEMPT", { attempts: store.applyOnCaptchaSite.attempts });
}

/** Confirmed apply on a captcha site (business success bar). */
export function noteCaptchaSiteApplyConfirmed(input: {
  solverProvider?: CaptchaSolverProvider;
  passiveOnly: boolean;
}): void {
  const store = readStore();
  const lane = store.applyOnCaptchaSite;
  lane.confirmed += 1;
  if (input.passiveOnly) {
    lane.confirmedPassiveOnly += 1;
  } else if (input.solverProvider === "buster") {
    lane.confirmedAfterBuster += 1;
  } else if (input.solverProvider === "2captcha") {
    lane.confirmedAfter2Captcha += 1;
  }
  store.lastApplyConfirmedAt = new Date().toISOString();
  store.updatedAt = new Date().toISOString();
  writeStore(store);
  log("CAPTCHA_SITE_APPLY_CONFIRMED", {
    confirmed: lane.confirmed,
    passiveOnly: input.passiveOnly,
    solverProvider: input.solverProvider,
  });
}

import type { CaptchaSignal } from "./captcha-signal.js";
import { noteCaptchaSiteApplyAttempt } from "./captcha-solver-stats.js";
import type { CaptchaSolverProvider } from "./captcha-solver-stats.js";

type CaptchaApplyContext = {
  hadCaptcha: boolean;
  lastSignal: CaptchaSignal;
  solverProvider?: CaptchaSolverProvider;
  applyAttemptCounted: boolean;
};

let current: CaptchaApplyContext | null = null;

export function resetCaptchaApplyContext(): void {
  current = null;
}

export function noteCaptchaSignalOnApply(signal: CaptchaSignal): void {
  if (signal === "none") {
    return;
  }
  const firstOnRun = !current?.applyAttemptCounted;
  current = {
    hadCaptcha: true,
    lastSignal: signal,
    solverProvider: current?.solverProvider,
    applyAttemptCounted: true,
  };
  if (firstOnRun) {
    noteCaptchaSiteApplyAttempt();
  }
}

export function noteCaptchaSolverProvider(provider: CaptchaSolverProvider): void {
  if (!current?.hadCaptcha) {
    current = {
      hadCaptcha: true,
      lastSignal: "active_challenge",
      solverProvider: provider,
      applyAttemptCounted: true,
    };
    noteCaptchaSiteApplyAttempt();
    return;
  }
  current.solverProvider = provider;
}

export function captchaApplyContext(): CaptchaApplyContext | null {
  return current;
}

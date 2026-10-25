import { env } from "../config/env.js";
import { log } from "../logging/logger.js";
import { parseGreenhouseOtpFromText } from "./greenhouse-otp.js";
import { getWorkspaceRuntime } from "../orchestration/workspace-runtime.js";
import { pollGreenhouseOtpFromGmail, type GmailOtpFailureReason } from "../orchestration/gmail-otp.js";
import {
  greenhouseOtpFailureHint,
  type GreenhouseOtpFailureReason as DiagnosticOtpReason,
} from "./greenhouse-otp-diagnostics.js";

export type GreenhouseOtpPollInput = {
  mailbox: string;
  notBefore: string;
  company?: string;
};

export type GreenhouseOtpFailureReason = DiagnosticOtpReason | GmailOtpFailureReason;

export { greenhouseOtpFailureHint };

export type GreenhouseOtpPollOutcome =
  | { ok: true; code: string; source: "gmail_api" | "webhook" }
  | { ok: false; reason: GreenhouseOtpFailureReason; source?: "gmail_api" | "webhook" | "none" };

type OtpWebhookResponse = {
  ok?: boolean;
  code?: string;
  message?: string;
};

/**
 * Prefer workspace Gmail token (native). Fall back to n8n webhook when no mailbox token.
 */
export async function pollGreenhouseOtp(input: GreenhouseOtpPollInput): Promise<GreenhouseOtpPollOutcome> {
  const runtime = getWorkspaceRuntime();
  const mailbox = (runtime?.mailboxEmail || input.mailbox).trim();
  if (runtime?.mailboxRefreshToken) {
    const gmail = await pollGreenhouseOtpFromGmail({
      refreshToken: runtime.mailboxRefreshToken,
      mailbox,
      notBefore: input.notBefore,
      company: input.company,
      timeoutMs: env.greenhouseOtpTimeoutMs,
      pollIntervalMs: env.greenhouseOtpPollIntervalMs,
    });
    if (gmail.ok) {
      log("GREENHOUSE_OTP_RECEIVED", { mailbox, source: "gmail_api", codeLength: gmail.code.length });
      return { ok: true, code: gmail.code, source: "gmail_api" };
    }
    return { ok: false, reason: gmail.reason, source: "gmail_api" };
  }

  const webhookOverride = runtime?.greenhouseOtpWebhookUrl?.trim();
  const url = (webhookOverride || env.greenhouseOtpWebhookUrl).trim();
  if (!url) {
    log("GREENHOUSE_OTP_SKIP", { reason: "no_mailbox_token_or_webhook" });
    return { ok: false, reason: "missing_mailbox_config", source: "none" };
  }
  const deadline = Date.now() + env.greenhouseOtpTimeoutMs;
  const intervalMs = env.greenhouseOtpPollIntervalMs;
  let lastReason: GreenhouseOtpFailureReason = "webhook_misconfigured";
  while (Date.now() < deadline) {
    const once = await fetchGreenhouseOtpOnce(url, { ...input, mailbox });
    if (once.ok) {
      log("GREENHOUSE_OTP_RECEIVED", { mailbox, source: "webhook", codeLength: once.code.length });
      return { ok: true, code: once.code, source: "webhook" };
    }
    lastReason = once.reason;
    await sleep(intervalMs);
  }
  log("GREENHOUSE_OTP_TIMEOUT", { mailbox, source: "webhook", timeoutMs: env.greenhouseOtpTimeoutMs, reason: lastReason });
  return { ok: false, reason: lastReason === "webhook_misconfigured" ? "poll_timeout" : lastReason, source: "webhook" };
}

async function fetchGreenhouseOtpOnce(
  url: string,
  input: GreenhouseOtpPollInput,
): Promise<{ ok: true; code: string } | { ok: false; reason: GreenhouseOtpFailureReason }> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.applyApiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mailbox: input.mailbox,
        notBefore: input.notBefore,
        company: input.company ?? "",
      }),
      signal: AbortSignal.timeout(25_000),
    });
    const raw = await response.text();
    let payload: OtpWebhookResponse = {};
    try {
      payload = JSON.parse(raw) as OtpWebhookResponse;
    } catch {
      log("GREENHOUSE_OTP_BAD_JSON", { status: response.status, body: raw.slice(0, 200) });
      return { ok: false, reason: "webhook_bad_response" };
    }
    if (!response.ok || !payload.ok || !payload.code) {
      return { ok: false, reason: "webhook_misconfigured" };
    }
    const code = String(payload.code).trim();
    if (!/^[A-Za-z0-9]{6,10}$/.test(code)) {
      return { ok: false, reason: "invalid_code_shape" };
    }
    return { ok: true, code };
  } catch (error) {
    const message = error instanceof Error ? error.message : "otp_fetch_failed";
    log("GREENHOUSE_OTP_FETCH_FAILED", { message });
    return { ok: false, reason: "webhook_misconfigured" };
  }
}

/** For unit tests and n8n code node parity. */
export function extractGreenhouseOtpFromEmailBody(body: string): string | null {
  return parseGreenhouseOtpFromText(body);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

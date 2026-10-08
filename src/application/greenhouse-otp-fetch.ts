import { env } from "../config/env.js";
import { log } from "../logging/logger.js";
import { parseGreenhouseOtpFromText } from "./greenhouse-otp.js";
import { getWorkspaceRuntime } from "../orchestration/workspace-runtime.js";
import { pollGreenhouseOtpFromGmail } from "../orchestration/gmail-otp.js";

export type GreenhouseOtpPollInput = {
  mailbox: string;
  notBefore: string;
  company?: string;
};

type OtpWebhookResponse = {
  ok?: boolean;
  code?: string;
  message?: string;
};

/**
 * Prefer workspace Gmail token (native). Fall back to n8n webhook when no mailbox token.
 */
export async function pollGreenhouseOtp(input: GreenhouseOtpPollInput): Promise<string | null> {
  const runtime = getWorkspaceRuntime();
  const mailbox = (runtime?.mailboxEmail || input.mailbox).trim();
  if (runtime?.mailboxRefreshToken) {
    return pollGreenhouseOtpFromGmail({
      refreshToken: runtime.mailboxRefreshToken,
      mailbox,
      notBefore: input.notBefore,
      company: input.company,
      timeoutMs: env.greenhouseOtpTimeoutMs,
      pollIntervalMs: env.greenhouseOtpPollIntervalMs,
    });
  }

  const webhookOverride = runtime?.greenhouseOtpWebhookUrl?.trim();
  const url = (webhookOverride || env.greenhouseOtpWebhookUrl).trim();
  if (!url) {
    log("GREENHOUSE_OTP_SKIP", { reason: "no_mailbox_token_or_webhook" });
    return null;
  }
  const deadline = Date.now() + env.greenhouseOtpTimeoutMs;
  const intervalMs = env.greenhouseOtpPollIntervalMs;
  while (Date.now() < deadline) {
    const code = await fetchGreenhouseOtpOnce(url, { ...input, mailbox });
    if (code) {
      log("GREENHOUSE_OTP_RECEIVED", { mailbox, source: "webhook", codeLength: code.length });
      return code;
    }
    await sleep(intervalMs);
  }
  log("GREENHOUSE_OTP_TIMEOUT", { mailbox, source: "webhook", timeoutMs: env.greenhouseOtpTimeoutMs });
  return null;
}

async function fetchGreenhouseOtpOnce(url: string, input: GreenhouseOtpPollInput): Promise<string | null> {
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
      return null;
    }
    if (!response.ok || !payload.ok || !payload.code) {
      return null;
    }
    const code = String(payload.code).trim();
    if (!/^[A-Za-z0-9]{6,10}$/.test(code)) {
      return null;
    }
    return code;
  } catch (error) {
    const message = error instanceof Error ? error.message : "otp_fetch_failed";
    log("GREENHOUSE_OTP_FETCH_FAILED", { message });
    return null;
  }
}

/** For unit tests and n8n code node parity. */
export function extractGreenhouseOtpFromEmailBody(body: string): string | null {
  return parseGreenhouseOtpFromText(body);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

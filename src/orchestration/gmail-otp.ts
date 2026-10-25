import { parseGreenhouseOtpFromText } from "../application/greenhouse-otp.js";
import { log } from "../logging/logger.js";
import { googleAccessTokenFromRefresh } from "./sheets/google-auth.js";

export type NativeOtpPollInput = {
  refreshToken: string;
  mailbox: string;
  notBefore: string;
  company?: string;
  timeoutMs: number;
  pollIntervalMs: number;
};

export type GmailOtpFailureReason =
  | "gmail_authorization_failed"
  | "gmail_list_failed"
  | "no_matching_message"
  | "poll_timeout";

export type GmailOtpPollOutcome =
  | { ok: true; code: string }
  | { ok: false; reason: GmailOtpFailureReason };

type GmailMessageList = { messages?: Array<{ id: string }> };
type GmailMessage = {
  id: string;
  internalDate?: string;
  snippet?: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
    body?: { data?: string };
    parts?: Array<{ body?: { data?: string }; parts?: unknown[] }>;
  };
};

export async function pollGreenhouseOtpFromGmail(input: NativeOtpPollInput): Promise<GmailOtpPollOutcome> {
  const deadline = Date.now() + input.timeoutMs;
  let lastReason: GmailOtpFailureReason = "no_matching_message";
  while (Date.now() < deadline) {
    const once = await fetchOtpOnce(input);
    if (once.ok) {
      return once;
    }
    lastReason = once.reason;
    if (once.reason === "gmail_authorization_failed" || once.reason === "gmail_list_failed") {
      return once;
    }
    await sleep(input.pollIntervalMs);
  }
  log("GREENHOUSE_OTP_TIMEOUT", { mailbox: input.mailbox, source: "gmail_api", timeoutMs: input.timeoutMs });
  return { ok: false, reason: lastReason === "no_matching_message" ? "poll_timeout" : lastReason };
}

async function fetchOtpOnce(
  input: NativeOtpPollInput,
): Promise<GmailOtpPollOutcome> {
  let token: string;
  try {
    token = await googleAccessTokenFromRefresh(input.refreshToken);
  } catch (error) {
    const message = error instanceof Error ? error.message : "gmail_auth_failed";
    log("GREENHOUSE_OTP_GMAIL_AUTH_FAILED", { message });
    return { ok: false, reason: "gmail_authorization_failed" };
  }
  const query = [
    "newer_than:2d",
    '(from:greenhouse-mail.io OR from:greenhouse.io OR subject:"security code")',
    input.mailbox ? `to:${input.mailbox}` : "",
    input.company ? `"${input.company.replace(/"/g, "")}"` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=8`;
  const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!listRes.ok) {
    const text = await listRes.text();
    log("GREENHOUSE_OTP_GMAIL_LIST_FAILED", { status: listRes.status, body: text.slice(0, 200) });
    return { ok: false, reason: "gmail_list_failed" };
  }
  const list = (await listRes.json()) as GmailMessageList;
  const messages = list.messages ?? [];
  if (messages.length === 0) {
    return { ok: false, reason: "no_matching_message" };
  }
  const notBeforeMs = input.notBefore ? Date.parse(input.notBefore) : Date.now() - 15 * 60_000;
  for (const msg of messages) {
    const fullRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!fullRes.ok) {
      continue;
    }
    const full = (await fullRes.json()) as GmailMessage;
    const internalDate = Number(full.internalDate || 0);
    if (internalDate && internalDate < notBeforeMs - 10_000) {
      continue;
    }
    const subject = full.payload?.headers?.find((h) => h.name === "Subject")?.value ?? "";
    const bodies: string[] = [];
    collectBodies(full.payload, bodies);
    const text = `${subject}\n${full.snippet || ""}\n${bodies.join("\n")}`;
    const code = parseGreenhouseOtpFromText(text);
    if (code) {
      return { ok: true, code };
    }
  }
  return { ok: false, reason: "no_matching_message" };
}

function collectBodies(part: GmailMessage["payload"] | undefined, out: string[]): void {
  if (!part) {
    return;
  }
  if (part.body?.data) {
    out.push(Buffer.from(part.body.data, "base64url").toString("utf8"));
  }
  if (Array.isArray(part.parts)) {
    for (const child of part.parts as GmailMessage["payload"][]) {
      collectBodies(child, out);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

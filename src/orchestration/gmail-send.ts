import { log } from "../logging/logger.js";
import { googleAccessTokenFromRefresh } from "./sheets/google-auth.js";

export type GmailSendInput = {
  refreshToken: string;
  to: string;
  subject: string;
  textBody: string;
  from?: string;
};

function encodeRawMessage(lines: string[]): string {
  const raw = lines.join("\r\n");
  return Buffer.from(raw, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Send a simple plain-text mail via Gmail API (requires gmail.send on the refresh token). */
export async function sendGmailPlain(input: GmailSendInput): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const token = await googleAccessTokenFromRefresh(input.refreshToken);
  const from = input.from?.trim() || "me";
  const raw = encodeRawMessage([
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    input.textBody,
  ]);
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) {
    const body = await res.text();
    log("GMAIL_SEND_FAILED", { status: res.status, body: body.slice(0, 240) });
    return { ok: false, reason: `gmail_send_${res.status}` };
  }
  const payload = (await res.json()) as { id?: string };
  log("GMAIL_SEND_OK", { to: input.to, messageId: payload.id ?? "" });
  return { ok: true, id: payload.id ?? "" };
}

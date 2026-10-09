import fs from "node:fs";
import path from "node:path";
import type { FreelancePackRecord } from "./build-pack.js";
import { sendGmailPlain } from "../orchestration/gmail-send.js";
import { log } from "../logging/logger.js";

type DigestState = {
  lastSentAt: string;
  packIds: string[];
};

function packsDir(): string {
  return process.env.FREELANCE_PACKS_DIR?.trim() || "/app/data/freelance-packs";
}

function statePath(): string {
  return path.join(packsDir(), "digest-state.json");
}

function previewPath(): string {
  return path.join(packsDir(), "latest-digest-preview.txt");
}

function loadState(): DigestState {
  const file = statePath();
  if (!fs.existsSync(file)) {
    return { lastSentAt: "", packIds: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as DigestState;
  } catch {
    return { lastSentAt: "", packIds: [] };
  }
}

function saveState(state: DigestState): void {
  const dir = packsDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(statePath(), `${JSON.stringify(state, null, 2)}\n`);
}

export function listFreelancePacks(): FreelancePackRecord[] {
  const dir = packsDir();
  if (!fs.existsSync(dir)) {
    return [];
  }
  const out: FreelancePackRecord[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json") || name === "digest-state.json") {
      continue;
    }
    try {
      out.push(JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as FreelancePackRecord);
    } catch {
      // skip corrupt pack
    }
  }
  out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return out;
}

export function buildFreelanceDigestText(packs: FreelancePackRecord[], maxItems = 7): string {
  const top = packs.slice(0, maxItems);
  const lines = [
    "Ahoy — actionable freelance packs (copy/paste ready). Praise the FSM.",
    "",
    `Items: ${top.length} (max ${maxItems} per digest)`,
    "",
  ];
  for (const pack of top) {
    lines.push(`--- ${pack.company} — ${pack.role} ---`);
    lines.push(`Link: ${pack.url || "(add Job URL on sheet row)"}`);
    lines.push(`Budget: ${pack.budgetHint || "ask client"}`);
    lines.push("");
    lines.push(pack.messageDraft);
    lines.push("");
    lines.push(`Portfolio: ${pack.portfolioUrl}`);
    lines.push(`Your step: ${pack.remainingStep}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function newPacksSinceLastDigest(): FreelancePackRecord[] {
  const state = loadState();
  const sent = new Set(state.packIds);
  return listFreelancePacks().filter((pack) => pack.state === "ready" && !sent.has(pack.packId));
}

export function writeDigestPreview(packs: FreelancePackRecord[]): string {
  const body = buildFreelanceDigestText(packs);
  const dir = packsDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(previewPath(), body);
  return body;
}

export type DigestSendResult = {
  previewPath: string;
  packCount: number;
  sent: boolean;
  reason?: string;
  messageId?: string;
};

export async function runFreelanceDigest(input: {
  refreshToken?: string;
  mailboxEmail?: string;
  forceSend?: boolean;
}): Promise<DigestSendResult> {
  const packs = newPacksSinceLastDigest();
  const preview = writeDigestPreview(packs);
  const result: DigestSendResult = {
    previewPath: previewPath(),
    packCount: packs.length,
    sent: false,
  };
  if (packs.length === 0) {
    result.reason = "no_new_packs";
    return result;
  }

  const sendEnabled =
    input.forceSend === true
    || process.env.FREELANCE_DIGEST_SEND?.trim().toLowerCase() === "true";
  if (!sendEnabled) {
    result.reason = "send_disabled_set_FREELANCE_DIGEST_SEND=true";
    log("FREELANCE_DIGEST_PREVIEW_READY", { packCount: packs.length, previewPath: previewPath() });
    return result;
  }

  const refresh = input.refreshToken?.trim();
  const to = input.mailboxEmail?.trim() || process.env.FREELANCE_DIGEST_TO?.trim();
  if (!refresh || !to) {
    result.reason = "missing_refresh_token_or_recipient";
    return result;
  }

  const subject =
    process.env.FREELANCE_DIGEST_SUBJECT?.trim()
    || `Freelance packs ready (${packs.length}) — ${new Date().toISOString().slice(0, 10)}`;

  const send = await sendGmailPlain({
    refreshToken: refresh,
    to,
    subject,
    textBody: preview,
  });
  if (!send.ok) {
    result.reason = send.reason;
    return result;
  }

  const state = loadState();
  state.lastSentAt = new Date().toISOString();
  state.packIds = [...new Set([...state.packIds, ...packs.map((p) => p.packId)])].slice(-500);
  saveState(state);
  result.sent = true;
  result.messageId = send.id;
  return result;
}

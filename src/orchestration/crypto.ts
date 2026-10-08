import crypto from "node:crypto";

const IV_BYTES = 12;
const TAG_BYTES = 16;

function encryptionKey(): Buffer | null {
  const raw = process.env.PLATFORM_ENCRYPTION_KEY?.trim();
  if (!raw) {
    return null;
  }
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

export function encryptSecret(plain: string): string {
  const key = encryptionKey();
  if (!key) {
    throw new Error("PLATFORM_ENCRYPTION_KEY is required to store workspace secrets.");
  }
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

export function decryptSecret(payload: string): string {
  const key = encryptionKey();
  if (!key) {
    throw new Error("PLATFORM_ENCRYPTION_KEY is required to read workspace secrets.");
  }
  const buf = Buffer.from(payload, "base64url");
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const data = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function hashWorkspaceToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

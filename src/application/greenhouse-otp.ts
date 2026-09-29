/** Parse Greenhouse job-application email verification codes from message bodies. */
export function parseGreenhouseOtpFromText(text: string): string | null {
  const normalized = text.replace(/\s+/g, " ");
  const patterns = [
    /security code field on your application:\s*([A-Za-z0-9]{8})\b/i,
    /verification code(?:\s+is)?[:\s]+([A-Za-z0-9]{8})\b/i,
    /security code[:\s]+([A-Za-z0-9]{8})\b/i,
    /enter the ([A-Za-z0-9]{8})-character code/i,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const candidate = match?.[1]?.trim();
    if (candidate && /^[A-Za-z0-9]{6,10}$/.test(candidate)) {
      return candidate;
    }
  }
  return null;
}

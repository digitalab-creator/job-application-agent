import dns from "node:dns/promises";

/**
 * A job URL whose hostname no longer exists in DNS is a dead posting (company retired the
 * careers subdomain), exactly like a 404. It must end as `closed`, not sit in Review forever.
 */

// Chromium's "this hostname does not exist" error. Other net::ERR_* values (timeouts,
// disconnects) are NOT dead-host signals and must keep going to Review.
const NAME_NOT_RESOLVED_RE = /ERR_NAME_NOT_RESOLVED/i;

// Node resolver code for NXDOMAIN. EAI_AGAIN (temporary resolver failure) is deliberately excluded.
const DNS_NOT_FOUND_CODE = "ENOTFOUND";

export function isNameNotResolvedError(message: string): boolean {
  return NAME_NOT_RESOLVED_RE.test(message);
}

/** True only when our own resolver also confirms NXDOMAIN, so a flaky container resolver never closes a live job. */
export async function hostDoesNotExist(url: string): Promise<boolean> {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }
  try {
    await dns.lookup(hostname);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === DNS_NOT_FOUND_CODE;
  }
}

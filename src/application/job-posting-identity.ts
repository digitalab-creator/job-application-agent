import { resolveGreenhouseApiTarget } from "./fetch-posting-text.js";
import { careersPositionId, greenhouseJobId } from "./openings.js";
import { gotFriendsPostingIdFromUrl } from "./submission-scope.js";
import { extractStrongJobId } from "./url-inspector.js";

/**
 * Authoritative posting identity for dedup across ATS URLs, employer career pages, and sheet rows.
 * Prefer Greenhouse slug+job id, then agency posting ids, then host+strong id, then URL shape.
 */
export function canonicalPostingKey(url: string): string | null {
  const trimmed = String(url || "").trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) {
    return null;
  }

  const greenhouse = resolveGreenhouseApiTarget(trimmed);
  if (greenhouse) {
    return `greenhouse:${greenhouse.slug}:${greenhouse.jobId}`;
  }

  try {
    const parsed = new URL(trimmed);
    const gidMatch = parsed.pathname.match(/\/careers\/gid-(\d+)/i);
    if (gidMatch?.[1]) {
      const slug = employerSlugFromHostname(parsed.hostname);
      if (slug) {
        return `greenhouse:${slug}:${gidMatch[1]}`;
      }
    }
    const ghJid = greenhouseJobId(parsed);
    if (ghJid) {
      const slug = employerSlugFromHostname(parsed.hostname);
      if (slug) {
        return `greenhouse:${slug}:${ghJid}`;
      }
    }
  } catch {
    // fall through to other keys
  }

  const gotFriendsId = gotFriendsPostingIdFromUrl(trimmed);
  if (gotFriendsId) {
    return `gotfriends:${gotFriendsId}`;
  }

  const drushimMatch = trimmed.match(/drushim\.co\.il\/(?:job|jobs)\/[^?#]*?(\d{5,})/i);
  if (drushimMatch?.[1]) {
    return `drushim:${drushimMatch[1]}`;
  }

  const jobmasterMatch = trimmed.match(/jobmaster\.co\.il\/(?:job|jobs)\/[^?#]*?(\d{4,})/i);
  if (jobmasterMatch?.[1]) {
    return `jobmaster:${jobmasterMatch[1]}`;
  }

  const positionId = careersPositionId(trimmed);
  if (positionId) {
    try {
      const host = new URL(trimmed).hostname.replace(/^www\./i, "").toLowerCase();
      return `${host}:position:${positionId}`;
    } catch {
      return null;
    }
  }

  const strongId = extractStrongJobId(trimmed);
  if (strongId) {
    try {
      const host = new URL(trimmed).hostname.replace(/^www\./i, "").toLowerCase();
      return `${host}:id:${strongId}`;
    } catch {
      return null;
    }
  }

  return null;
}

/** Stable key for sheet Unique Key column, discovery filters, and submission dedup. */
export function uniqueKeyForUrl(url: string): string {
  const canonical = canonicalPostingKey(url);
  if (canonical) {
    return canonical;
  }
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.replace(/\/$/, "").toLowerCase();
    const ghJid = greenhouseJobId(parsed);
    const base = `${host}${path}`;
    return ghJid ? `${base}?gh_jid=${ghJid}` : base;
  } catch {
    return String(url || "").trim().toLowerCase();
  }
}

function employerSlugFromHostname(hostname: string): string | null {
  const slug = hostname.replace(/^www\./i, "").split(".")[0]?.toLowerCase() ?? "";
  if (!slug || slug.length < 2) {
    return null;
  }
  return slug;
}

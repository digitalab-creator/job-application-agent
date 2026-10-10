export type PostingContentKind =
  | "ok"
  | "access_blocked"
  | "login_wall"
  | "search_results"
  | "thin"
  | "careers_directory";

export type PostingContentVerdict = {
  kind: PostingContentKind;
  reason: string;
};

const ACCESS_BLOCKED = /cloudflare|checking your browser|ray id|access denied|attention required|you have been blocked|bot detection|cf-browser-verification|enable javascript and cookies/i;
const LOGIN_WALL = /\bsign in\b|\blog in\b|authentication required|login to continue/i;
const SEARCH_RESULTS = /search results|jobs matching|open positions in your search|no jobs found|filter by|sort by relevance/i;
const JOB_SIGNALS = /responsibilities|requirements|qualifications|what you'll do|about the role|מועמדות|דרישות|תיאור התפקיד|apply now|הגשת מועמדות/i;

/** Non-JD page bodies must not be scored as candidate fit. */
export function classifyPostingContent(text: string, url = ""): PostingContentVerdict {
  const blob = `${text}\n${url}`.trim();
  const lower = blob.toLowerCase();
  if (ACCESS_BLOCKED.test(blob)) {
    return {
      kind: "access_blocked",
      reason: "Page content looks like an access or bot challenge, not a job description.",
    };
  }
  if (LOGIN_WALL.test(blob) && !JOB_SIGNALS.test(blob)) {
    return {
      kind: "login_wall",
      reason: "Page content looks like a login wall without job requirements.",
    };
  }
  if (/jobmaster\.co\.il\/jobs\/.*\/q-/i.test(url) || /\/jobs\/\/q-/i.test(url)) {
    return {
      kind: "search_results",
      reason: "URL points to a job search listing, not a specific posting.",
    };
  }
  if (SEARCH_RESULTS.test(blob) && !roleTitleInText(url, blob)) {
    return {
      kind: "search_results",
      reason: "Page content looks like search results, not a single job posting.",
    };
  }
  if (blob.length < 120) {
    return {
      kind: "thin",
      reason: `Job description text is too short (${blob.length} chars).`,
    };
  }
  if (blob.length < 400 && !JOB_SIGNALS.test(blob)) {
    return {
      kind: "thin",
      reason: "Not enough job-description signal in page text.",
    };
  }
  if (/see all (jobs|positions)|view all openings|current openings at/i.test(lower) && !JOB_SIGNALS.test(blob)) {
    return {
      kind: "careers_directory",
      reason: "Page looks like a careers directory, not a specific role.",
    };
  }
  return { kind: "ok", reason: "" };
}

function roleTitleInText(url: string, text: string): boolean {
  try {
    const path = new URL(url).pathname;
    const slug = path.split("/").filter(Boolean).pop() ?? "";
    if (slug.length < 4) {
      return false;
    }
    return text.toLowerCase().includes(slug.replace(/-/g, " ").slice(0, 24));
  } catch {
    return false;
  }
}

export function postingContentBlocksFit(verdict: PostingContentVerdict): boolean {
  return verdict.kind !== "ok";
}

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { log } from "../logging/logger.js";

export type ProposedFact = {
  id: string;
  requirement: string;
  repo: string;
  path: string;
  draft: string;
  verified: false;
  at: string;
};

function proposedPath(): string {
  return process.env.PROPOSED_FACTS_PATH?.trim() || "/app/data/ledger/proposed-facts.jsonl";
}

/** Search allowlisted repos. Never marks a fact verified. */
export async function proposeFactsFromGithub(requirement: string): Promise<ProposedFact[]> {
  const token = process.env.GITHUB_TOKEN?.trim();
  const repos = (process.env.GITHUB_EVIDENCE_REPOS?.trim() || "digitalab-creator/legal-ai")
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!token || repos.length === 0) {
    log("GITHUB_EVIDENCE_SKIPPED", { reason: token ? "no_repos" : "no_token" });
    return [];
  }
  const query = requirement.replace(/[^\p{L}\p{N}\s+-]/gu, " ").trim().slice(0, 80);
  if (query.length < 3) {
    return [];
  }
  const out: ProposedFact[] = [];
  for (const repo of repos.slice(0, 5)) {
    const url = `https://api.github.com/search/code?q=${encodeURIComponent(`${query} repo:${repo}`)}&per_page=3`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "job-application-agent",
      },
    });
    if (res.status === 403 || res.status === 429) {
      log("GITHUB_EVIDENCE_RATE_LIMITED", { status: res.status, repo });
      break;
    }
    if (!res.ok) {
      continue;
    }
    const json = await res.json() as { items?: Array<{ path?: string; html_url?: string }> };
    for (const item of json.items ?? []) {
      const draft = `GitHub hit in ${repo} at ${item.path ?? "unknown"} may relate to: ${requirement}. Confirm before treating as experience.`;
      const row: ProposedFact = {
        id: `gh-${crypto.createHash("sha1").update(`${repo}:${item.path}:${requirement}`).digest("hex").slice(0, 10)}`,
        requirement,
        repo,
        path: item.path ?? "",
        draft,
        verified: false,
        at: new Date().toISOString(),
      };
      out.push(row);
    }
  }
  if (out.length) {
    const file = proposedPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, out.map((row) => JSON.stringify(row)).join("\n") + "\n");
    log("GITHUB_EVIDENCE_PROPOSED", { count: out.length, requirement });
  }
  return out;
}

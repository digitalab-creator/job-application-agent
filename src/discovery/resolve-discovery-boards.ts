import { parseHttpUrl } from "../application/automatable-url.js";
import { DEFAULT_VERIFIED_ATS_DISCOVERY_BOARDS } from "./default-discovery-boards.js";

/** Board seed URLs that are category hubs, not company ATS roots. */
export function isDiscoveryBoardHubUrl(url: string): boolean {
  const parsed = parseHttpUrl(url);
  if (!parsed) {
    return true;
  }
  const path = parsed.pathname.replace(/\/+$/, "") || "/";
  if (/naturalint\.com$/i.test(parsed.hostname) && /\/jobs$/i.test(path)) {
    return true;
  }
  if (/^\/jobs$/i.test(path) && !/comeet\.com/i.test(parsed.hostname)) {
    return true;
  }
  return false;
}

export function resolveDiscoveryBoardUrls(input: {
  workspaceBoards?: string[];
  envBoardsCsv?: string;
  includeDefaultAtsBoards?: boolean;
}): string[] {
  const fromWorkspace = (input.workspaceBoards ?? [])
    .map((part) => part.trim())
    .filter((part) => /^https?:\/\//i.test(part));
  const fromEnv = (input.envBoardsCsv ?? "")
    .split(/[\n,]+/)
    .map((part) => part.trim())
    .filter((part) => /^https?:\/\//i.test(part));
  const defaults = input.includeDefaultAtsBoards !== false
    ? [...DEFAULT_VERIFIED_ATS_DISCOVERY_BOARDS]
    : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of [...fromWorkspace, ...fromEnv, ...defaults]) {
    const normalized = url.replace(/\/+$/, "");
    if (seen.has(normalized) || isDiscoveryBoardHubUrl(url)) {
      continue;
    }
    seen.add(normalized);
    out.push(url);
  }
  return out;
}

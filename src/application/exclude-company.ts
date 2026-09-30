import fs from "node:fs";
import path from "node:path";

/**
 * Companies we never auto-apply to.
 * Admin SSOT = Google Sheet tab "Exclude Companies" (same jobs spreadsheet).
 * n8n syncs that sheet into this runtime file each apply run.
 * Env APPLY_EXCLUDED_COMPANIES seeds the file only when it is missing.
 */
export type ExcludedCompaniesConfig = {
  companies: string[];
  updatedAt?: string;
  source?: string;
};

const DEFAULT_SEED = ["בורודה קפלן", "k-logic", "two-solutions"];

export function normalizeCompanyKey(value: string): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\s_\-./]+/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function parseExcludedCompaniesText(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(raw || "").split(/[\n,;]+/)) {
    const company = part.trim();
    if (!company) {
      continue;
    }
    const key = normalizeCompanyKey(company);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(company);
  }
  return out;
}

export function excludedCompaniesPath(): string {
  const fromEnv = process.env.APPLY_EXCLUDED_COMPANIES_PATH?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  return "/app/data/config/excluded-companies.json";
}

export function getExcludedCompanies(): string[] {
  const filePath = excludedCompaniesPath();
  try {
    if (fs.existsSync(filePath)) {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as ExcludedCompaniesConfig | string[];
      const list = Array.isArray(raw) ? raw : raw.companies;
      if (Array.isArray(list)) {
        return normalizeCompanyList(list.map(String));
      }
    }
  } catch {
    // Fall through to env / seed.
  }
  const fromEnv = process.env.APPLY_EXCLUDED_COMPANIES?.trim();
  if (fromEnv) {
    return parseExcludedCompaniesText(fromEnv);
  }
  return [...DEFAULT_SEED];
}

export function setExcludedCompanies(
  companies: string[],
  source = "api",
): ExcludedCompaniesConfig {
  const normalized = normalizeCompanyList(companies);
  const payload: ExcludedCompaniesConfig = {
    companies: normalized,
    updatedAt: new Date().toISOString(),
    source,
  };
  const filePath = excludedCompaniesPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

export function ensureExcludedCompaniesConfig(): ExcludedCompaniesConfig {
  const filePath = excludedCompaniesPath();
  if (fs.existsSync(filePath)) {
    return {
      companies: getExcludedCompanies(),
      updatedAt: undefined,
      source: "file",
    };
  }
  const fromEnv = process.env.APPLY_EXCLUDED_COMPANIES?.trim();
  const seed = fromEnv ? parseExcludedCompaniesText(fromEnv) : [...DEFAULT_SEED];
  return setExcludedCompanies(seed, fromEnv ? "env" : "seed");
}

export function isExcludedApplyCompany(
  company: string,
  excluded: readonly string[] = getExcludedCompanies(),
): boolean {
  const key = normalizeCompanyKey(company);
  if (!key) {
    return false;
  }
  for (const item of excluded) {
    const needle = normalizeCompanyKey(item);
    if (!needle) {
      continue;
    }
    if (key === needle || key.includes(needle)) {
      return true;
    }
  }
  return false;
}

function normalizeCompanyList(companies: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const company of companies) {
    const trimmed = String(company || "").trim();
    if (!trimmed) {
      continue;
    }
    const key = normalizeCompanyKey(trimmed);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

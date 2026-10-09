import fs from "node:fs";
import path from "node:path";
import { candidate } from "../config/candidate.js";
import type { JobSheetRow } from "../orchestration/sheets/job-sheet.js";
import { opportunityKindFromRow } from "./opportunity-kind.js";

export type FreelancePackRecord = {
  packId: string;
  createdAt: string;
  opportunityKind: string;
  company: string;
  role: string;
  url: string;
  budgetHint: string;
  whyFit: string;
  contactRoute: string;
  messageDraft: string;
  portfolioUrl: string;
  remainingStep: string;
  sheetRowNumber?: number;
  state: "draft" | "ready";
};

function packsDir(): string {
  const base = process.env.FREELANCE_PACKS_DIR?.trim() || "/app/data/freelance-packs";
  return base;
}

export function buildFreelancePack(row: JobSheetRow, rowNumber?: number): FreelancePackRecord {
  const company = String(row.Company ?? "Client").trim() || "Client";
  const role = String(row.Role ?? "Project").trim() || "Project";
  const url = String(row["Job URL"] ?? "").trim();
  const budgetHint = String(row["Est. Salary Range"] ?? row["Project Budget"] ?? "").trim();
  const whyFit = String(row["Why It Fits"] ?? "").trim();
  const kind = opportunityKindFromRow(row);
  const portfolioUrl = candidate.portfolio.automation;
  const budgetLine = budgetHint
    ? `התקציב שפורסם: ${budgetHint}.`
    : "לא פורסם תקציב — אשמח להבין היקף, דדליין ומבנה תשלום (מקדמה + אבני דרך).";

  const messageDraft = [
    `שלום,`,
    ``,
    `ראיתי את הפרויקט "${role}"${company !== "Client" ? ` (${company})` : ""}.`,
    whyFit ? `${whyFit}` : `אני מתמחה באוטומציות, אינטגרציות API ו-AI למערכות קיימות — פרויקט מוגדר במחיר קבוע.`,
    ``,
    budgetLine,
    `אם רלוונטי, אשמח לשיחה קצרה השבוע.`,
    ``,
    `${candidate.fullName}`,
    portfolioUrl,
  ].join("\n");

  const contactRoute = url || "פתח את הקישור במקור (גיליון Job URL) ובחר 'צור קשר' / הגשת הצעה שם.";

  return {
    packId: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    createdAt: new Date().toISOString(),
    opportunityKind: kind,
    company,
    role,
    url,
    budgetHint,
    whyFit,
    contactRoute,
    messageDraft,
    portfolioUrl,
    remainingStep: url
      ? "העתק את ההודעה למקור, צרף פורטפוליו/CV לפי הדרישה, ושלח — אין שליחה אוטומטית מהמערכת."
      : "הוסף Job URL לשורה ונסה שוב.",
    sheetRowNumber: rowNumber,
    state: url ? "ready" : "draft",
  };
}

export function persistFreelancePack(pack: FreelancePackRecord): string {
  const dir = packsDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${pack.packId}.json`);
  fs.writeFileSync(file, `${JSON.stringify(pack, null, 2)}\n`);
  return file;
}

export function formatPackForSheetNotes(pack: FreelancePackRecord): string {
  return [
    "FREELANCE_PACK",
    `pack_id=${pack.packId}`,
    `state=${pack.state}`,
    "",
    "=== MESSAGE (copy) ===",
    pack.messageDraft,
    "",
    "=== CONTACT ===",
    pack.contactRoute,
    "",
    "=== PORTFOLIO ===",
    pack.portfolioUrl,
    "",
    "=== YOUR STEP ===",
    pack.remainingStep,
  ].join("\n");
}

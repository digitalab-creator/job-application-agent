import http from "node:http";
import { chromium } from "playwright";
import { ensureExcludedCompaniesConfig, getExcludedCompanies, setExcludedCompanies } from "./application/exclude-company.js";
import { ensureExcludedLocationsConfig, getExcludedLocations, setExcludedLocations } from "./application/exclude-location.js";
import { applyToJob, type ApplyInput } from "./application/apply-job.js";
import { quotaIsOpen, quotaSnapshot, rememberQuotaUse } from "./application/daily-quota.js";
import { claimApplyRun, releaseApplyRun } from "./application/run-lock.js";
import { withApplySession, withHeadlessBrowser } from "./browser/session.js";
import { removeOldScreenshots } from "./browser/screenshot.js";
import { cvFileStatus, env } from "./config/env.js";
import { buildCvDocument, writeCvPdf } from "./cv/generate.js";
import { choosePersonaFromText } from "./cv/persona-from-text.js";
import { budgetIsOpen, budgetSnapshot, recordPlatformAllocationIfNeeded } from "./budget/monthly-budget.js";
import { runDiscovery } from "./discovery/run-discovery.js";
import { recordExternalSpend, todayCostSummary, withJobCost } from "./llm/cost-ledger.js";
import { log } from "./logging/logger.js";
import type { ApplicationResult } from "./models/types.js";

let busy = false;
ensureExcludedCompaniesConfig();
ensureExcludedLocationsConfig();

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url?.startsWith("/health")) {
      const health = await healthCheck();
      send(res, health.ok ? 200 : 503, health);
      return;
    }
    if (!authorized(req)) {
      send(res, 401, { error: "unauthorized" });
      return;
    }
    if (req.method === "GET" && req.url?.startsWith("/quota")) {
      send(res, 200, quotaSnapshot());
      return;
    }
    if (req.method === "GET" && (req.url === "/config/excluded-companies" || req.url?.startsWith("/config/excluded-companies?"))) {
      send(res, 200, { companies: getExcludedCompanies() });
      return;
    }
    if (req.method === "PUT" && req.url === "/config/excluded-companies") {
      const body = await readBody(req) as { companies?: unknown; source?: unknown };
      if (!Array.isArray(body.companies)) {
        send(res, 400, { error: "companies must be an array of strings." });
        return;
      }
      const companies = body.companies.map((item) => String(item ?? "").trim()).filter(Boolean);
      const source = typeof body.source === "string" && body.source.trim() ? body.source.trim() : "api";
      const saved = setExcludedCompanies(companies, source);
      log("EXCLUDED_COMPANIES_UPDATED", { count: saved.companies.length, source: saved.source });
      send(res, 200, saved);
      return;
    }
    if (req.method === "GET" && (req.url === "/config/excluded-locations" || req.url?.startsWith("/config/excluded-locations?"))) {
      send(res, 200, { locations: getExcludedLocations() });
      return;
    }
    if (req.method === "PUT" && req.url === "/config/excluded-locations") {
      const body = await readBody(req) as { locations?: unknown; source?: unknown };
      if (!Array.isArray(body.locations)) {
        send(res, 400, { error: "locations must be an array of strings." });
        return;
      }
      const locations = body.locations.map((item) => String(item ?? "").trim()).filter(Boolean);
      const source = typeof body.source === "string" && body.source.trim() ? body.source.trim() : "api";
      const saved = setExcludedLocations(locations, source);
      log("EXCLUDED_LOCATIONS_UPDATED", { count: saved.locations.length, source: saved.source });
      send(res, 200, saved);
      return;
    }
    if (req.method === "GET" && req.url?.startsWith("/budget")) {
      recordPlatformAllocationIfNeeded();
      send(res, 200, budgetSnapshot());
      return;
    }
    if (req.method === "GET" && req.url?.startsWith("/costs")) {
      send(res, 200, todayCostSummary());
      return;
    }
    if (req.method === "POST" && req.url === "/costs/record") {
      recordPlatformAllocationIfNeeded();
      const body = await readBody(req) as {
        source?: string;
        usd?: number;
        ils?: number;
        label?: string;
        note?: string;
      };
      const source = body.source === "discovery" || body.source === "external" || body.source === "platform"
        ? body.source
        : "external";
      const rate = budgetSnapshot().usdIlsRate;
      const usd = typeof body.usd === "number" && Number.isFinite(body.usd) ? body.usd : 0;
      const ils = typeof body.ils === "number" && Number.isFinite(body.ils)
        ? body.ils
        : usd * rate;
      if (ils <= 0) {
        send(res, 400, { error: "Provide a positive ils or usd amount." });
        return;
      }
      recordExternalSpend({
        month: budgetSnapshot().month,
        source,
        label: body.label?.trim() || "n8n_manual",
        ils,
        usd,
        note: body.note?.trim() || "",
      });
      send(res, 200, budgetSnapshot());
      return;
    }
    if (req.method === "POST" && req.url === "/discover/scan") {
      recordPlatformAllocationIfNeeded();
      const body = await readBody(req) as {
        existingUrls?: string[];
        newQueueStats?: { tech?: number; marketing?: number; total?: number; techPct?: number };
      };
      const existingUrls = Array.isArray(body.existingUrls)
        ? body.existingUrls.filter((url) => typeof url === "string")
        : [];
      const stats = body.newQueueStats;
      const newQueueStats = stats && typeof stats.techPct === "number"
        ? {
            tech: Number(stats.tech) || 0,
            marketing: Number(stats.marketing) || 0,
            total: Number(stats.total) || 0,
            techPct: stats.techPct,
          }
        : undefined;
      const result = await runDiscovery({ existingUrls, newQueueStats });
      send(res, 200, result);
      return;
    }
    if (req.method === "POST" && req.url === "/runs/claim") {
      const claim = claimApplyRun();
      send(res, claim.ok ? 200 : 409, claim);
      return;
    }
    if (req.method === "POST" && req.url === "/runs/release") {
      send(res, 200, releaseApplyRun());
      return;
    }
    if (req.method === "POST" && req.url === "/apply") {
      if (busy) {
        send(res, 409, { status: "failed", submitted: false, confirmationDetected: false, notes: "Another application is already running." });
        return;
      }
      busy = true;
      try {
        const input = parseApply(await readBody(req));
        recordPlatformAllocationIfNeeded();
        if (!budgetIsOpen()) {
          const budget = budgetSnapshot();
          send(res, 200, {
            status: "budget_reached",
            jobUrl: input.job.url,
            submitted: false,
            confirmationDetected: false,
            llmCostUsd: 0,
            budget: compactBudget(budget),
            notes: [
              "result=budget_reached",
              `monthly_budget_ils=${budget.spentIls}/${budget.limitIls}`,
              "The shared monthly budget is exhausted. This job was not opened.",
            ].join("\n"),
          });
          return;
        }
        if (!quotaIsOpen()) {
          const quota = quotaSnapshot();
          send(res, 200, {
            status: "quota_reached",
            jobUrl: input.job.url,
            submitted: false,
            confirmationDetected: false,
            llmCostUsd: 0,
            quota,
            notes: [
              "result=quota_reached",
              `daily_quota=${quota.counted}/${quota.limit}`,
              "The daily limit is already used. This job was not opened.",
            ].join("\n"),
          });
          return;
        }
        try {
          const tracked = await withJobCost(input.job.url, () => withApplySession((context) => applyToJob(context, input)));
          rememberQuotaUse({ url: input.job.url, status: tracked.result.status });
          const quota = quotaSnapshot();
          const budget = budgetSnapshot();
          const outcome = tracked.result;
          outcome.llmCostUsd = tracked.usd;
          outcome.quota = quota;
          outcome.budget = compactBudget(budget);
          outcome.notes = [
            outcome.notes,
            `llm_cost_usd=${tracked.usd}`,
            `llm_calls=${tracked.calls}`,
            `daily_quota=${quota.counted}/${quota.limit}`,
            `monthly_budget_ils=${budget.spentIls}/${budget.limitIls}`,
          ].filter(Boolean).join("\n");
          send(res, 200, outcome);
        } catch (error) {
          const message = error instanceof Error ? error.message : "request_failed";
          log("REQUEST_FAILED", { message });
          rememberQuotaUse({ url: input.job.url, status: "review" });
          send(res, 200, {
            status: "review",
            jobUrl: input.job.url,
            submitted: false,
            confirmationDetected: false,
            blocker: "navigation_failed",
            notes: ["result=review", "blocker=navigation_failed", message.split("\n", 1)[0]].join("\n"),
          });
        }
      } finally {
        busy = false;
      }
      return;
    }
    if (req.method === "POST" && req.url === "/cv/preview") {
      const rawBody = await readBody(req);
      const input = parseApply(rawBody);
      const previewExtras = rawBody as ApplyInput & { jobText?: string };
      const preview = await withHeadlessBrowser(async (browser) => {
        const persona = choosePersonaFromText(input.job.role, input.job.category ?? "", input.job.role);
        const jobText = typeof previewExtras.jobText === "string" ? previewExtras.jobText : input.job.role;
        const built = await buildCvDocument({
          persona,
          role: input.job.role,
          company: input.job.company,
          jobText,
        });
        const outputPath = `${env.generatedCvDir}/preview-${Date.now()}.pdf`;
        await writeCvPdf(browser, built.doc, persona, outputPath);
        return { persona, wording: built.wording, cvPath: outputPath, headlineId: built.doc.headlineId };
      });
      send(res, 200, preview);
      return;
    }
    send(res, 404, { error: "not_found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "request_failed";
    log("REQUEST_FAILED", { message });
    const failed: ApplicationResult = {
      status: "failed",
      jobUrl: "",
      submitted: false,
      confirmationDetected: false,
      notes: message,
    };
    send(res, 500, failed);
  }
});

server.listen(env.port, () => {
  removeOldScreenshots(env.screenshotDir, env.screenshotRetentionDays);
  log("SERVER_STARTED", { port: env.port, browserPersistentProfile: env.browserPersistentProfile, browserApplyHeadless: env.browserApplyHeadless });
});

async function healthCheck(): Promise<Record<string, unknown>> {
  const files = cvFileStatus();
  let browserOk = false;
  let browserError = "";
  try {
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    browserOk = true;
  } catch (error) {
    browserError = error instanceof Error ? error.message : "browser_failed";
  }
  const llmConfigured = env.llmApiKey.length > 10;
  recordPlatformAllocationIfNeeded();
  const budget = budgetSnapshot();
  return {
    ok: files.technical && files.marketing && browserOk && llmConfigured,
    technicalCv: files.technical,
    marketingCv: files.marketing,
    browserOk,
    browserError,
    llmConfigured,
    dailyApplyLimit: quotaSnapshot().limit,
    dailyApplyCounted: quotaSnapshot().counted,
    llmCostUsdToday: todayCostSummary().usd,
    monthlyBudgetLimitIls: budget.limitIls,
    monthlyBudgetSpentIls: budget.spentIls,
    monthlyBudgetRemainingIls: budget.remainingIls,
    browserPersistentProfile: env.browserPersistentProfile,
    browserApplyHeadless: env.browserApplyHeadless,
    browserUserDataDir: env.browserUserDataDir,
    excludedCompanies: getExcludedCompanies().length,
    excludedLocations: getExcludedLocations().length,
  };
}

function authorized(req: http.IncomingMessage): boolean {
  return req.headers.authorization === `Bearer ${env.applyApiToken}`;
}

function parseApply(body: unknown): ApplyInput {
  if (!body || typeof body !== "object") {
    throw new Error("Request body must be a JSON object.");
  }
  const record = body as { row?: number; submit?: boolean; ignoreLedger?: boolean; job?: ApplyInput["job"] };
  const job = record.job;
  if (!job?.url || !job.role || !job.company) {
    throw new Error("job.url, job.role, and job.company are required.");
  }
  if (!/^https?:\/\//i.test(job.url)) {
    throw new Error("job.url must be an http(s) URL.");
  }
  return {
    row: record.row,
    submit: record.submit === true,
    ignoreLedger: record.ignoreLedger === true,
    job,
  };
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      if (chunks.reduce((sum, part) => sum + part.length, 0) > 1_000_000) {
        reject(new Error("Request body is too large."));
      }
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw) as unknown);
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function compactBudget(budget: ReturnType<typeof budgetSnapshot>): ApplicationResult["budget"] {
  return {
    month: budget.month,
    limitIls: budget.limitIls,
    spentIls: budget.spentIls,
    remainingIls: budget.remainingIls,
    open: budget.open,
  };
}

function send(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

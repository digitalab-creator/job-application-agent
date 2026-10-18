import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";
import { ensureExcludedCompaniesConfig, getExcludedCompanies, setExcludedCompanies } from "./application/exclude-company.js";
import { ensureExcludedLocationsConfig, getExcludedLocations, setExcludedLocations } from "./application/exclude-location.js";
import { type ApplyInput } from "./application/apply-job.js";
import { newAttemptId } from "./application/attempt-ledger.js";
import { executeApply } from "./application/execute-apply.js";
import { applyPolicySnapshot } from "./application/apply-policy.js";
import { quotaSnapshot } from "./application/daily-quota.js";
import { browserApplyLockHeld, claimBrowserApply, releaseBrowserApply } from "./application/browser-apply-lock.js";
import { claimApplyRun, releaseApplyRun } from "./application/run-lock.js";
import { withHeadlessBrowser } from "./browser/session.js";
import { removeOldScreenshots } from "./browser/screenshot.js";
import { cvFileStatus, env, orchestrationMode } from "./config/env.js";
import { authorizeWorkspaceRun } from "./orchestration/auth.js";
import { runWorkspaceApplyDaily } from "./orchestration/apply-daily.js";
import { runWorkspaceDailyPipeline } from "./orchestration/daily-pipeline.js";
import { buildOrchestrationReadiness } from "./orchestration/orchestration-readiness.js";
import { runWorkspaceDiscoverDaily } from "./orchestration/discover-daily.js";
import { runWorkspaceEmailOutcomes } from "./orchestration/email-outcomes.js";
import { buildFreelanceDigestText, listFreelancePacks, newPacksSinceLastDigest, runFreelanceDigest } from "./freelance/digest.js";
import { decryptSecret } from "./orchestration/crypto.js";
import { computeQueueDepthSnapshot } from "./orchestration/queue-depth.js";
import { getWorkspace, listEnabledWorkspaces } from "./orchestration/workspace-store.js";
import { readExcludeCompanies, readJobSheetRows } from "./orchestration/sheets/job-sheet.js";
import { startNativeScheduler } from "./orchestration/scheduler.js";
import { ensureWorkspaceSchema, workspaceDatabaseUrl } from "./orchestration/db.js";
import { runtimeFromWorkspace, withWorkspaceRuntime } from "./orchestration/workspace-runtime.js";
import { pickWorkspaceApplyBatch } from "./orchestration/pick-jobs.js";
import { captchaSolverStatsSnapshot } from "./application/captcha-solver-stats.js";
import { resolveApplyCapability } from "./application/ats-capability.js";
import { inspectJobUrl } from "./application/link-liveness.js";
import {
  recommendQueueStatus,
  recommendStatusFromCapabilityOnly,
  recoverCanonicalJobUrls,
} from "./application/queue-sheet-verdict.js";
import { runQueueRecheck } from "./orchestration/queue-recheck.js";
import type { JobSheetRow } from "./orchestration/sheets/job-sheet.js";
import { buildCvDocument, writeCvPdf } from "./cv/generate.js";
import { choosePersonaFromText } from "./cv/persona-from-text.js";
import { budgetSnapshot, recordPlatformAllocationIfNeeded } from "./budget/monthly-budget.js";
import { marketingShareFromPolicy } from "./config/search-policy.js";
import { runDiscovery } from "./discovery/run-discovery.js";
import { countUnresolvedSheetRows } from "./orchestration/sheet-backlog.js";
import { loadSearchPolicyFromSheet } from "./orchestration/sheets/search-config.js";
import { recordExternalSpend, todayCostSummary } from "./llm/cost-ledger.js";
import { log } from "./logging/logger.js";
import type { ApplicationResult } from "./models/types.js";
import { listRecentAttempts, resolveAttemptExport } from "./observability/attempt-export.js";
import {
  collectApplyAttemptLedgerPaths,
  readAttemptsFromLedgerPaths,
} from "./observability/attempt-sources.js";
import {
  collectDockerLogEvents,
  summarizeAttemptErrors,
  tailJsonlByAttempt,
} from "./observability/log-tail.js";
import { handleMcpApplyOne, handleMcpPreviewCv } from "./observability/mcp-apply-handler.js";
import { buildJobDetailExport, buildQueueExport } from "./observability/queue-export.js";
import { listRecentNativeRuns, resolveDeployAttestation } from "./observability/run-export.js";

ensureExcludedCompaniesConfig();
ensureExcludedLocationsConfig();

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url?.startsWith("/health")) {
      const health = await healthCheck();
      send(res, health.ok ? 200 : 503, health);
      return;
    }
    if (req.method === "GET" && (req.url === "/ready" || req.url?.startsWith("/ready?"))) {
      const readiness = await buildOrchestrationReadiness();
      send(res, readiness.ok ? 200 : 503, readiness);
      return;
    }
    const workspaceRun = parseWorkspaceRunPath(req.method ?? "", req.url ?? "");
    if (workspaceRun) {
      const token = bearerToken(req);
      const auth = await authorizeWorkspaceRun(workspaceRun.workspaceId, token);
      if (!auth.ok) {
        send(res, 401, { error: auth.reason });
        return;
      }
      const workspace = await getWorkspace(workspaceRun.workspaceId);
      if (!workspace) {
        send(res, 404, { error: "workspace_not_found" });
        return;
      }
      const body = await readBody(req) as { dryRun?: boolean; submit?: boolean };
      if (workspaceRun.kind === "apply-run") {
        const result = await runWorkspaceApplyDaily({
          workspace,
          runSource: "native_manual",
          submit: body.submit !== false,
          dryRun: body.dryRun === true,
        });
        send(res, 200, result);
        return;
      }
      if (workspaceRun.kind === "pipeline-run") {
        const result = await runWorkspaceDailyPipeline({
          workspace,
          runSource: "native_manual",
          submit: body.submit !== false,
          dryRun: body.dryRun === true,
        });
        send(res, 200, result);
        return;
      }
      if (workspaceRun.kind === "outcome-run") {
        const result = await runWorkspaceEmailOutcomes({
          workspace,
          runSource: "native_manual",
          dryRun: body.dryRun === true,
        });
        send(res, 200, result);
        return;
      }
      if (workspaceRun.kind === "discover-run") {
        const result = await runWorkspaceDiscoverDaily({
          workspace,
          runSource: "native_manual",
          dryRun: body.dryRun === true,
        });
        send(res, 200, result);
        return;
      }
      send(res, 404, { error: "unknown_workspace_run" });
      return;
    }
    if (!authorized(req)) {
      send(res, 401, { error: "unauthorized" });
      return;
    }
    if (req.method === "GET" && req.url?.startsWith("/quota")) {
      send(res, 200, applyPolicySnapshot());
      return;
    }
    if (req.method === "GET" && req.url?.startsWith("/search-policy")) {
      const workspaceId = new URL(req.url, "http://local").searchParams.get("workspaceId") ?? "internal";
      const workspace = await getWorkspace(workspaceId);
      if (!workspace) {
        send(res, 404, { error: "workspace_not_found" });
        return;
      }
      const policy = await loadSearchPolicyFromSheet(workspace);
      const rows = await readJobSheetRows(workspace);
      const depth = computeQueueDepthSnapshot(rows, await readExcludeCompanies(workspace));
      send(res, 200, {
        ...policy,
        categoryWeights: [...policy.categoryWeights.entries()],
        marketingShare: marketingShareFromPolicy(policy),
        unresolvedReviewManual: countUnresolvedSheetRows(rows),
        actionableAutomatable: depth.automatableEmployment,
        eligibleEmployment: depth.eligibleEmployment,
      });
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
    if (req.method === "GET" && req.url?.startsWith("/observability/")) {
      const parsed = new URL(req.url, "http://127.0.0.1");
      const path = parsed.pathname;
      const workspaceId = parsed.searchParams.get("workspaceId")?.trim() || "internal";
      const workspace = await getWorkspace(workspaceId);
      if (!workspace) {
        send(res, 404, { error: "workspace_not_found" });
        return;
      }
      if (path === "/observability/queue") {
        const limit = Number(parsed.searchParams.get("limit") ?? "25");
        const statusFilter = parsed.searchParams.get("status") ?? undefined;
        send(res, 200, await buildQueueExport(workspace, { limit, statusFilter }));
        return;
      }
      if (path === "/observability/job") {
        const rowNumber = parsed.searchParams.get("rowNumber");
        const jobUrl = parsed.searchParams.get("url") ?? undefined;
        const detail = await buildJobDetailExport(workspace, {
          rowNumber: rowNumber ? Number(rowNumber) : undefined,
          jobUrl,
        });
        if (!detail) {
          send(res, 404, { error: "job_not_found" });
          return;
        }
        send(res, 200, detail);
        return;
      }
      if (path === "/observability/attempts") {
        const limit = Number(parsed.searchParams.get("limit") ?? "20");
        send(res, 200, { attempts: listRecentAttempts(limit, workspace) });
        return;
      }
      if (path.startsWith("/observability/attempt/")) {
        const attemptId = decodeURIComponent(path.slice("/observability/attempt/".length));
        const resolved = await resolveAttemptExport(attemptId, workspace);
        if (resolved.status === "not_found") {
          send(res, 404, {
            error: "attempt_not_found",
            attemptId,
            ledgerSources: resolved.ledgerSources,
            message: resolved.message,
          });
          return;
        }
        if (resolved.status === "sheet_only") {
          send(res, 200, {
            resolution: resolved.status,
            attemptId,
            sheetHint: resolved.sheetHint,
            ledgerSources: resolved.ledgerSources,
            message: resolved.message,
          });
          return;
        }
        send(res, 200, { ...resolved.attempt, resolution: resolved.status, ledgerSources: resolved.ledgerSources });
        return;
      }
      if (path === "/observability/native-runs") {
        const limit = Number(parsed.searchParams.get("limit") ?? "20");
        send(res, 200, { runs: listRecentNativeRuns(limit) });
        return;
      }
      if (path === "/observability/deploy-info") {
        const attestation = resolveDeployAttestation();
        send(res, 200, {
          deployedSha: attestation.deployedSha,
          deployAttestation: attestation,
          orchestrationMode: orchestrationMode(),
          workspaceDatabaseConfigured: Boolean(workspaceDatabaseUrl()),
        });
        return;
      }
      if (path === "/observability/queue-depth") {
        const rows = await readJobSheetRows(workspace);
        const excluded = await readExcludeCompanies(workspace);
        send(res, 200, {
          workspaceId: workspace.id,
          ...computeQueueDepthSnapshot(rows, excluded),
        });
        return;
      }
      if (path === "/observability/docker-logs") {
        const sinceMinutes = Number(parsed.searchParams.get("sinceMinutes") ?? "120");
        const limit = Number(parsed.searchParams.get("limit") ?? "100");
        const attemptId = parsed.searchParams.get("attemptId") ?? undefined;
        const event = parsed.searchParams.get("event") ?? undefined;
        const docker = collectDockerLogEvents({
          container: process.env.JOB_AGENT_CONTAINER_NAME?.trim() || "job-application-agent",
          sinceMinutes,
          attemptId,
          event,
          limit,
        });
        send(res, 200, docker);
        return;
      }
      if (path === "/observability/attempt-trace") {
        const attemptId = parsed.searchParams.get("attemptId")?.trim();
        if (!attemptId) {
          send(res, 400, { error: "attemptId_required" });
          return;
        }
        const resolved = await resolveAttemptExport(attemptId, workspace);
        if (resolved.status === "not_found") {
          send(res, 404, {
            error: "attempt_not_found",
            attemptId,
            ledgerSources: resolved.ledgerSources,
            message: resolved.message,
          });
          return;
        }
        const jsonlHits: Record<string, unknown>[] = [];
        for (const ledgerPath of collectApplyAttemptLedgerPaths(workspace)) {
          jsonlHits.push(...tailJsonlByAttempt(ledgerPath, attemptId, 80));
        }
        const sinceMinutes = Number(parsed.searchParams.get("sinceMinutes") ?? "180");
        const docker = collectDockerLogEvents({
          container: process.env.JOB_AGENT_CONTAINER_NAME?.trim() || "job-application-agent",
          sinceMinutes,
          attemptId,
          limit: 80,
        });
        send(res, 200, {
          resolution: resolved.status,
          attempt: resolved.status === "found" ? resolved.attempt : null,
          sheetHint: resolved.status === "sheet_only" ? resolved.sheetHint : null,
          message: resolved.status === "sheet_only" ? resolved.message : undefined,
          ledgerSources: resolved.ledgerSources,
          jsonlHits: jsonlHits.slice(-80),
          docker,
        });
        return;
      }
      if (path === "/observability/error-summary") {
        const limit = Number(parsed.searchParams.get("limit") ?? "500");
        const { attempts } = readAttemptsFromLedgerPaths(collectApplyAttemptLedgerPaths(workspace));
        const slice = attempts.slice(-Math.min(Math.max(1, limit), 2000));
        send(res, 200, { summary: summarizeAttemptErrors(slice) });
        return;
      }
      send(res, 404, { error: "observability_route_not_found" });
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
    if (req.method === "GET" && req.url?.startsWith("/metrics/captcha-solvers")) {
      send(res, 200, captchaSolverStatsSnapshot());
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
    if (req.method === "GET" && req.url?.startsWith("/runtime/ledger-paths")) {
      send(res, 200, {
        ledgerPath: env.ledgerPath,
        applyAttemptsPath: env.applyAttemptsPath,
        nativeRunLogPath: process.env.NATIVE_RUN_LOG_PATH?.trim() || "/app/data/ledger/native-runs.jsonl",
        orchestrationMode: orchestrationMode(),
      });
      return;
    }
    if (req.method === "GET" && req.url?.startsWith("/queue/snapshot")) {
      const workspaces = await listEnabledWorkspaces();
      const workspace = workspaces[0];
      if (!workspace) {
        send(res, 503, { error: "no_enabled_workspace" });
        return;
      }
      const rows = await readJobSheetRows(workspace);
      const excluded = await readExcludeCompanies(workspace);
      send(res, 200, {
        workspaceId: workspace.id,
        ledgerPath: workspace.ledgerPath ?? env.ledgerPath,
        applyAttemptsPath: workspace.applyAttemptsPath ?? env.applyAttemptsPath,
        ...computeQueueDepthSnapshot(rows, excluded),
      });
      return;
    }
    if (req.method === "GET" && (req.url === "/freelance/digest/preview" || req.url?.startsWith("/freelance/digest/preview?"))) {
      const packs = newPacksSinceLastDigest();
      const body = packs.length > 0 ? buildFreelanceDigestText(packs) : buildFreelanceDigestText(listFreelancePacks());
      send(res, 200, {
        packCount: packs.length,
        sendEnabled: process.env.FREELANCE_DIGEST_SEND?.trim().toLowerCase() === "true",
        body,
      });
      return;
    }
    if (req.method === "POST" && req.url === "/freelance/digest/send") {
      const body = await readBody(req) as { confirm?: string };
      if (body.confirm !== "SEND_FREELANCE_DIGEST") {
        send(res, 400, {
          error: "consent_required",
          hint: 'POST {"confirm":"SEND_FREELANCE_DIGEST"} and set FREELANCE_DIGEST_SEND=true',
        });
        return;
      }
      const workspaces = await listEnabledWorkspaces();
      const workspace = workspaces[0];
      const enc = workspace?.mailboxRefreshTokenEnc ?? workspace?.googleRefreshTokenEnc;
      const result = await runFreelanceDigest({
        refreshToken: enc ? decryptSecret(enc) : undefined,
        mailboxEmail:
          workspace?.mailboxEmail
          ?? workspace?.notificationTarget
          ?? process.env.FREELANCE_DIGEST_TO?.trim(),
        forceSend: true,
      });
      send(res, result.sent ? 200 : 409, result);
      return;
    }
    if (req.method === "GET" && req.url?.startsWith("/queue/capability")) {
      const parsed = new URL(req.url, "http://127.0.0.1");
      const target = parsed.searchParams.get("url") ?? "";
      send(res, 200, {
        url: target,
        capability: resolveApplyCapability(target),
        classifyOnly: recommendStatusFromCapabilityOnly(resolveApplyCapability(target), target),
      });
      return;
    }
    if (req.method === "POST" && req.url === "/queue/verify") {
      const body = await readBody(req) as {
        url?: string;
        role?: string;
        currentStatus?: string;
        notes?: string;
      };
      const rawUrl = String(body.url ?? "").trim();
      const url = recoverCanonicalJobUrls(rawUrl)[0] ?? rawUrl;
      const liveness = await inspectJobUrl(url, String(body.role ?? ""));
      const capability = resolveApplyCapability(liveness.finalUrl || url);
      const verifiedAt = new Date().toISOString();
      const recommendation = recommendQueueStatus({
        currentStatus: String(body.currentStatus ?? "New"),
        notes: String(body.notes ?? ""),
        rawJobUrl: rawUrl,
        role: String(body.role ?? ""),
        capability,
        liveness,
        verifiedAt,
      });
      send(res, 200, { url, capability, liveness, recommendation, verifiedAt });
      return;
    }
    if (req.method === "POST" && req.url === "/queue/recheck") {
      const body = await readBody(req) as {
        workspaceId?: string;
        dryRun?: boolean;
        limit?: number;
        offset?: number;
        statuses?: string[];
      };
      const workspaceId = String(body.workspaceId ?? "internal").trim();
      const workspace = await getWorkspace(workspaceId);
      if (!workspace) {
        send(res, 404, { error: "workspace_not_found" });
        return;
      }
      const result = await runQueueRecheck({
        workspace,
        dryRun: body.dryRun !== false,
        limit: body.limit,
        offset: body.offset,
        statuses: body.statuses,
      });
      send(res, result.status === "error" ? 500 : 200, result);
      return;
    }
    if (req.method === "POST" && req.url === "/queue/pick") {
      const body = await readBody(req) as {
        rows?: JobSheetRow[];
        excludedCompanies?: string[];
        pickLimit?: number;
      };
      if (!Array.isArray(body.rows)) {
        send(res, 400, { error: "rows must be an array of sheet row objects." });
        return;
      }
      const excluded = Array.isArray(body.excludedCompanies)
        ? body.excludedCompanies.map((item) => String(item ?? "").trim()).filter(Boolean)
        : getExcludedCompanies();
      const classified = body.rows.map((row) => ({
        ...row,
        capability: resolveApplyCapability(String(row["Job URL"] ?? "")),
      }));
      const batch = pickWorkspaceApplyBatch(classified, excluded, body.pickLimit);
      send(res, 200, {
        selected: batch.selected,
        pickedTech: batch.pickedTech,
        pickedMarketing: batch.pickedMarketing,
        eligible: batch.eligible,
        capabilities: classified.map((row) => ({
          url: row["Job URL"],
          capability: row.capability,
        })),
      });
      return;
    }
    if (req.method === "POST" && req.url === "/discover/scan") {
      recordPlatformAllocationIfNeeded();
      const body = await readBody(req) as {
        existingUrls?: string[];
        newQueueStats?: { tech?: number; marketing?: number; total?: number; techPct?: number; statusNew?: number };
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
            statusNew: typeof stats.statusNew === "number" ? stats.statusNew : undefined,
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
    if (req.method === "GET" && req.url?.startsWith("/generated-cv/")) {
      if (!authorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      const rel = decodeURIComponent(req.url.slice("/generated-cv/".length).split("?")[0] ?? "");
      const safe = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
      const filePath = path.join(env.generatedCvDir, safe);
      if (!filePath.startsWith(path.resolve(env.generatedCvDir)) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        send(res, 404, { error: "not_found" });
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${path.basename(filePath)}"`,
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
    if (req.method === "POST" && req.url === "/apply") {
      const browserClaim = claimBrowserApply();
      if (!browserClaim.ok) {
        send(res, 409, {
          status: "failed",
          submitted: false,
          confirmationDetected: false,
          blocker: "apply_in_progress",
          notes: "Another application is already using the browser profile. Retry shortly.",
        });
        return;
      }
      try {
        const input = parseApply(await readBody(req));
        input.attemptId = newAttemptId();
        input.startedAt = new Date().toISOString();
        const outcome = await executeApplyInWorkspace(input);
        send(res, 200, outcome);
      } finally {
        releaseBrowserApply();
      }
      return;
    }
    if (req.method === "POST" && req.url === "/mcp/preview-cv") {
      const body = await readBody(req) as {
        workspaceId?: string;
        rowNumber?: number;
        jobText?: string;
      };
      const workspaceId = String(body.workspaceId ?? "internal").trim();
      const workspace = await getWorkspace(workspaceId);
      if (!workspace) {
        send(res, 404, { error: "workspace_not_found" });
        return;
      }
      const rowNumber = Number(body.rowNumber);
      if (!Number.isFinite(rowNumber) || rowNumber < 2) {
        send(res, 400, { error: "rowNumber_required" });
        return;
      }
      const preview = await handleMcpPreviewCv({ workspace, rowNumber, jobText: body.jobText });
      send(res, preview.error ? 404 : 200, preview);
      return;
    }
    if (req.method === "POST" && req.url === "/mcp/apply-one") {
      const body = await readBody(req) as {
        workspaceId?: string;
        rowNumber?: number;
        submit?: boolean;
        idempotencyKey?: string;
        jobText?: string;
      };
      const idempotencyKey = String(body.idempotencyKey ?? "").trim();
      if (!idempotencyKey) {
        send(res, 400, { error: "idempotencyKey_required" });
        return;
      }
      const workspaceId = String(body.workspaceId ?? "internal").trim();
      const workspace = await getWorkspace(workspaceId);
      if (!workspace) {
        send(res, 404, { error: "workspace_not_found" });
        return;
      }
      const rowNumber = Number(body.rowNumber);
      if (!Number.isFinite(rowNumber) || rowNumber < 2) {
        send(res, 400, { error: "rowNumber_required" });
        return;
      }
      const submit = body.submit === true;
      const result = await handleMcpApplyOne({
        workspace,
        rowNumber,
        submit,
        idempotencyKey,
        jobText: body.jobText,
      });
      const status = result.error === "apply_in_progress" || result.error === "apply_run_in_progress" ? 409 : result.error ? 404 : 200;
      send(res, status, result);
      return;
    }
    if (req.method === "POST" && req.url === "/cv/preview") {
      const rawBody = await readBody(req);
      const input = parseApply(rawBody);
      const previewExtras = rawBody as ApplyInput & { jobText?: string };
      const preview = await withHeadlessBrowser(async (browser) => {
        const persona = choosePersonaFromText(input.job.role, input.job.category ?? "", input.job.role);
        if (!persona) {
          throw new Error("The preview role is ambiguous; provide jobText with enough requirements to choose a persona.");
        }
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
  log("SERVER_STARTED", {
    port: env.port,
    orchestrationMode: orchestrationMode(),
    browserPersistentProfile: env.browserPersistentProfile,
    browserApplyHeadless: env.browserApplyHeadless,
  });
  void ensureWorkspaceSchema()
    .then(() => startNativeScheduler())
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      log("ORCHESTRATION_BOOT_FAILED", { message });
    });
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
  const captchaSolvers = captchaSolverStatsSnapshot();
  return {
    ok: files.technical && files.marketing && browserOk && llmConfigured,
    technicalCv: files.technical,
    marketingCv: files.marketing,
    browserOk,
    browserError,
    llmConfigured,
    dailyApplySafetyAttempts: quotaSnapshot().maxAttempts,
    dailyApplyAttemptsToday: quotaSnapshot().attempted,
    llmCostUsdToday: todayCostSummary().usd,
    monthlyBudgetLimitIls: budget.limitIls,
    monthlyBudgetSpentIls: budget.spentIls,
    monthlyBudgetRemainingIls: budget.remainingIls,
    dailyBudgetIls: budget.dailyBudgetIls,
    dailyBudgetSpentIls: budget.dailySpentIls,
    dailyBudgetRemainingIls: budget.dailyRemainingIls,
    browserPersistentProfile: env.browserPersistentProfile,
    browserApplyHeadless: env.browserApplyHeadless,
    browserUserDataDir: env.browserUserDataDir,
    excludedCompanies: getExcludedCompanies().length,
    excludedLocations: getExcludedLocations().length,
    applyInProgress: browserApplyLockHeld(),
    orchestrationMode: orchestrationMode(),
    readinessPath: "/ready",
    ledgerPath: env.ledgerPath,
    applyAttemptsPath: env.applyAttemptsPath,
    captchaSolvers: {
      activeChallenges: captchaSolvers.activeChallenges,
      buster: captchaSolvers.buster,
      twoCaptcha: captchaSolvers.twoCaptcha,
      successRate: captchaSolvers.successRate,
      lastSuccessProvider: captchaSolvers.lastSuccessProvider,
      lastSuccessAt: captchaSolvers.lastSuccessAt,
    },
  };
}

function authorized(req: http.IncomingMessage): boolean {
  return req.headers.authorization === `Bearer ${env.applyApiToken}`;
}

function parseApply(body: unknown): ApplyInput {
  if (!body || typeof body !== "object") {
    throw new Error("Request body must be a JSON object.");
  }
  const record = body as {
    row?: number;
    submit?: boolean;
    ignoreLedger?: boolean;
    job?: ApplyInput["job"];
    workspaceId?: string;
    runSource?: ApplyInput["runSource"];
    runId?: string;
    batchId?: string;
    triggeredAt?: string;
  };
  const job = record.job;
  if (!job?.url || !job.role || !job.company) {
    throw new Error("job.url, job.role, and job.company are required.");
  }
  if (typeof job.url !== "string") {
    throw new Error("job.url must be a string.");
  }
  const runSource = parseRunSource(record.runSource);
  return {
    row: record.row,
    submit: record.submit === true,
    ignoreLedger: record.ignoreLedger === true,
    workspaceId: typeof record.workspaceId === "string" && record.workspaceId.trim()
      ? record.workspaceId.trim()
      : "internal",
    runSource,
    runId: typeof record.runId === "string" ? record.runId : undefined,
    batchId: typeof record.batchId === "string" ? record.batchId : undefined,
    triggeredAt: typeof record.triggeredAt === "string" ? record.triggeredAt : undefined,
    job,
  };
}

function parseRunSource(value: unknown): ApplyInput["runSource"] {
  const allowed = new Set([
    "n8n_schedule",
    "n8n_webhook",
    "retry_batch",
    "manual",
    "native_schedule",
    "native_manual",
  ]);
  if (typeof value === "string" && allowed.has(value)) {
    return value as ApplyInput["runSource"];
  }
  return "manual";
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

function bearerToken(req: http.IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return undefined;
  }
  return header.slice("Bearer ".length).trim();
}

async function executeApplyInWorkspace(input: ApplyInput): Promise<ApplicationResult> {
  const workspaceId = input.workspaceId ?? "internal";
  if (!workspaceDatabaseUrl()) {
    return executeApply(input);
  }
  try {
    const workspace = await getWorkspace(workspaceId);
    if (!workspace) {
      log("APPLY_WORKSPACE_MISSING", { workspaceId });
      if (workspaceId !== "internal") {
        throw new Error(`Workspace ${workspaceId} was not found.`);
      }
      return executeApply(input);
    }
    return await withWorkspaceRuntime(
      runtimeFromWorkspace(workspace, input.runSource ?? "manual", {
        runId: input.runId,
        batchId: input.batchId,
      }),
      () => executeApply(input),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("APPLY_WORKSPACE_RUNTIME_FAILED", { workspaceId, message });
    if (workspaceId === "internal") {
      return executeApply(input);
    }
    throw error;
  }
}

function parseWorkspaceRunPath(
  method: string,
  url: string,
): { workspaceId: string; kind: "apply-run" | "pipeline-run" | "discover-run" | "outcome-run" } | null {
  if (method !== "POST") {
    return null;
  }
  const pathOnly = url.split("?")[0] ?? "";
  const apply = /^\/workspaces\/([^/]+)\/apply-run$/.exec(pathOnly);
  if (apply) {
    return { workspaceId: decodeURIComponent(apply[1]), kind: "apply-run" };
  }
  const pipeline = /^\/workspaces\/([^/]+)\/pipeline-run$/.exec(pathOnly);
  if (pipeline) {
    return { workspaceId: decodeURIComponent(pipeline[1]), kind: "pipeline-run" };
  }
  const discover = /^\/workspaces\/([^/]+)\/discover-run$/.exec(pathOnly);
  if (discover) {
    return { workspaceId: decodeURIComponent(discover[1]), kind: "discover-run" };
  }
  const outcome = /^\/workspaces\/([^/]+)\/outcome-run$/.exec(pathOnly);
  if (outcome) {
    return { workspaceId: decodeURIComponent(outcome[1]), kind: "outcome-run" };
  }
  return null;
}

function send(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

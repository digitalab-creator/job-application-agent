import type { Request, Response, NextFunction } from "express";
import { gatewayConfig } from "./config.js";

function bearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return undefined;
  }
  return header.slice("Bearer ".length).trim();
}

export function requireMcpBearer(req: Request, res: Response, next: NextFunction): void {
  const token = bearerToken(req);
  if (!token || token !== gatewayConfig.mcpAccessToken.trim()) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

/** Reject cross-tenant MCP tool calls — credential is bound to one workspace. */
export function resolveAuthorizedWorkspaceId(workspaceId?: string | null): string {
  const requested = workspaceId?.trim();
  const allowed = gatewayConfig.defaultWorkspaceId.trim();
  if (requested && requested !== allowed) {
    throw new Error(`workspace_forbidden:${requested}`);
  }
  return allowed;
}

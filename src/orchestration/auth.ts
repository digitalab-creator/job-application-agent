import { hashWorkspaceToken } from "./crypto.js";
import { getWorkspace } from "./workspace-store.js";

export async function authorizeWorkspaceRun(
  workspaceId: string,
  bearerToken: string | undefined,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!bearerToken?.trim()) {
    return { ok: false, reason: "missing_token" };
  }
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) {
    return { ok: false, reason: "workspace_not_found" };
  }
  if (!workspace.enabled) {
    return { ok: false, reason: "workspace_disabled" };
  }
  const hash = hashWorkspaceToken(bearerToken.trim());
  if (hash !== workspace.runTokenHash) {
    return { ok: false, reason: "invalid_token" };
  }
  return { ok: true };
}

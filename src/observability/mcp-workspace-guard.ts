export function mcpAllowedWorkspaceId(): string {
  return process.env.JOBAGENT_MCP_ALLOWED_WORKSPACE_ID?.trim() || "internal";
}

export function assertMcpWorkspaceAccess(workspaceId: string): string {
  const allowed = mcpAllowedWorkspaceId();
  const requested = workspaceId.trim();
  if (!requested || requested !== allowed) {
    return "";
  }
  return requested;
}

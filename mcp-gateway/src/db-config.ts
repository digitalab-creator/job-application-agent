const PRIVILEGED_URL_MARKERS = [
  /postgres:\/\/jobagent:jobagent@/i,
  /user=jobagent\b/i,
  /\/jobagent:jobagent@/i,
];

export function assertMcpReadOnlyDatabaseUrl(url: string): void {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error("JOBAGENT_MCP_DATABASE_URL is required for MCP database tools.");
  }
  for (const pattern of PRIVILEGED_URL_MARKERS) {
    if (pattern.test(trimmed)) {
      throw new Error(
        "JOBAGENT_MCP_DATABASE_URL must use the dedicated jobagent_mcp_readonly role, not the application DB user.",
      );
    }
  }
  if (!/\/jobagent_mcp_readonly[:@]/i.test(trimmed) && !/user=jobagent_mcp_readonly\b/i.test(trimmed)) {
    throw new Error("JOBAGENT_MCP_DATABASE_URL must authenticate as jobagent_mcp_readonly.");
  }
}

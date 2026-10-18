function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : fallback;
}

export const gatewayConfig = {
  port: Number(optional("MCP_GATEWAY_PORT", "3101")),
  mcpAccessToken: required("JOBAGENT_MCP_ACCESS_TOKEN"),
  jobAgentBaseUrl: optional("JOBAGENT_API_BASE_URL", "http://127.0.0.1:3099").replace(/\/$/, ""),
  jobAgentApiToken: process.env.JOBAGENT_API_TOKEN?.trim() || process.env.APPLY_API_TOKEN?.trim() || required("JOBAGENT_API_TOKEN"),
  readOnlyDatabaseUrl: optional("JOBAGENT_MCP_DATABASE_URL", ""),
  defaultWorkspaceId: optional("JOBAGENT_DEFAULT_WORKSPACE_ID", "internal"),
  githubRepo: optional("JOBAGENT_GITHUB_REPO", "digitalab-creator/job-application-agent"),
  githubToken: optional("GITHUB_TOKEN", ""),
  auditLogPath: optional("MCP_GATEWAY_AUDIT_LOG", "/app/data/ledger/mcp-gateway-audit.jsonl"),
};

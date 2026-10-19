import assert from "node:assert/strict";
import test from "node:test";

test("resolveAuthorizedWorkspaceId allows default workspace only", async () => {
  process.env.JOBAGENT_MCP_DATABASE_URL = "postgres://jobagent_mcp_readonly:test@127.0.0.1:5433/jobagent";
  process.env.JOBAGENT_MCP_ACCESS_TOKEN = "test-mcp-token";
  process.env.JOBAGENT_API_TOKEN = "test-api-token";
  process.env.JOBAGENT_DEFAULT_WORKSPACE_ID = "internal";
  const { resolveAuthorizedWorkspaceId } = await import("./auth.js");
  assert.equal(resolveAuthorizedWorkspaceId(undefined), "internal");
  assert.equal(resolveAuthorizedWorkspaceId("internal"), "internal");
  assert.throws(() => resolveAuthorizedWorkspaceId("other-tenant"), /workspace_forbidden/);
});

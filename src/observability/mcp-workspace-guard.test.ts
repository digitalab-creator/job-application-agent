import assert from "node:assert/strict";
import test from "node:test";
import { assertMcpWorkspaceAccess, mcpAllowedWorkspaceId } from "./mcp-workspace-guard.js";

test("assertMcpWorkspaceAccess rejects cross-workspace ids", () => {
  const prev = process.env.JOBAGENT_MCP_ALLOWED_WORKSPACE_ID;
  process.env.JOBAGENT_MCP_ALLOWED_WORKSPACE_ID = "internal";
  assert.equal(mcpAllowedWorkspaceId(), "internal");
  assert.equal(assertMcpWorkspaceAccess("internal"), "internal");
  assert.equal(assertMcpWorkspaceAccess("other"), "");
  if (prev) {
    process.env.JOBAGENT_MCP_ALLOWED_WORKSPACE_ID = prev;
  } else {
    delete process.env.JOBAGENT_MCP_ALLOWED_WORKSPACE_ID;
  }
});

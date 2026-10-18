import assert from "node:assert/strict";
import test from "node:test";
import { assertMcpReadOnlyDatabaseUrl } from "./db-config.js";

test("rejects privileged postgres fallback URLs", () => {
  assert.throws(
    () => assertMcpReadOnlyDatabaseUrl("postgres://jobagent:jobagent@workspace-db:5432/jobagent"),
    /jobagent_mcp_readonly/,
  );
});

test("requires jobagent_mcp_readonly role in connection URL", () => {
  assert.throws(() => assertMcpReadOnlyDatabaseUrl(""), /required/);
  assert.throws(
    () => assertMcpReadOnlyDatabaseUrl("postgres://other:secret@localhost/jobagent"),
    /jobagent_mcp_readonly/,
  );
  assert.doesNotThrow(() =>
    assertMcpReadOnlyDatabaseUrl("postgres://jobagent_mcp_readonly:secret@127.0.0.1:5433/jobagent"),
  );
});

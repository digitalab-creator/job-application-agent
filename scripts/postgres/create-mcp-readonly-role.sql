-- Run as a superuser on the jobagent database. Replace placeholders before execution.
-- Creates a read-only role for the MCP gateway (no write privileges).

CREATE ROLE jobagent_mcp_readonly LOGIN PASSWORD 'REPLACE_WITH_STRONG_PASSWORD';
GRANT CONNECT ON DATABASE jobagent TO jobagent_mcp_readonly;
GRANT USAGE ON SCHEMA public TO jobagent_mcp_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO jobagent_mcp_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO jobagent_mcp_readonly;

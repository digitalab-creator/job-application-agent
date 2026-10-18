-- Run connected as jobagent_mcp_readonly after create-mcp-readonly-role.sql.
-- Each statement must fail (insufficient privilege).

-- INSERT INTO orchestration_runs (workspace_id, kind, run_source, started_at, status) VALUES ('internal', 'test', 'test', NOW(), 'failed');
-- UPDATE workspaces SET display_name = display_name WHERE id = 'internal';
-- DELETE FROM orchestration_runs WHERE id = -1;
-- CREATE TABLE mcp_should_fail (id int);

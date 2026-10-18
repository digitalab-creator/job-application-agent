# ChatGPT MCP integration — executable plan

## Phase 0 findings (2026-10-18)

| Item | Verified state |
| --- | --- |
| Live worker | `http://127.0.0.1:3099` healthy, `orchestrationMode=native` |
| Deployed SHA | `c78b2fc140ef5b618cd9e66e23c017647afc55cf` (`tmp/deploy/latest-release.json`) |
| Workspace | `internal`, spreadsheet configured via env (`WORKSPACE_INTERNAL_*`) |
| Database | PostgreSQL `workspace-db` on `127.0.0.1:5433`, schema in `src/orchestration/db.ts` |
| Evidence | `apply-attempts.jsonl`, `native-runs.jsonl`, docker JSON logs |
| CI | `CI` workflow on self-hosted `digitalab-prod`; deploy via `Deploy` workflow |
| ChatGPT route | Custom MCP plugin: HTTPS **Streamable HTTP** or **SSE**, OAuth or static bearer ([OpenAI MCP docs](https://developers.openai.com/api/docs/guides/custom-mcp-server)) |
| CaseEdge MCP | Not present in this repo; reuse ChatGPT **GitHub** plugin for PR workflow |

## Architecture

```
ChatGPT → (HTTPS tunnel) → mcp-gateway:3101/mcp → job-application-agent:3099
                         ↘ read-only Postgres (jobagent_mcp_readonly)
```

No second scheduler, browser engine, or sheet writer.

## Phases

### A — Read-only observability (implemented in this branch)

- `mcp-gateway/` Streamable HTTP MCP server
- `GET /observability/*` on the worker (Bearer `APPLY_API_TOKEN`)
- Predefined read-only SQL in the gateway
- Audit JSONL at `data/ledger/mcp-gateway-audit.jsonl`

### B — Safe apply operations

- `jobagent_preview_cv`, `jobagent_apply_one` proxying `/cv/preview` and `/apply` with idempotency keys and explicit `submit`

### C — Dev adapter + live verification

- Restricted test runner; E2E ChatGPT trace; one authorized live apply after approval

## User setup (secrets — names only)

| Secret | Purpose |
| --- | --- |
| `JOBAGENT_MCP_ACCESS_TOKEN` | ChatGPT → MCP gateway |
| `JOBAGENT_API_TOKEN` | Gateway → worker API (same as `APPLY_API_TOKEN`) |
| `JOBAGENT_API_BASE_URL` | Internal worker URL |
| `JOBAGENT_MCP_DATABASE_URL` | `postgres://jobagent_mcp_readonly:…@workspace-db:5432/jobagent` |
| `GITHUB_TOKEN` | Optional release status tool |

Expose gateway with **Secure MCP Tunnel** or reverse proxy TLS; do not publish Postgres or port 3099.

### ChatGPT plugin authentication (tunnel)

The tunnel does **not** forward a Bearer token from the ChatGPT UI to `127.0.0.1:3101`. `tunnel-client` injects `Authorization` via `MCP_EXTRA_HEADERS` from `JOBAGENT_MCP_ACCESS_TOKEN` in `.env` (see `scripts/systemd-mcp-tunnel-run.sh`).

In ChatGPT **Add custom MCP server**, use **Connection → Tunnel** and set plugin authentication to **No authentication** (upstream auth is on the server). If you use Bearer in ChatGPT, it must still match `JOBAGENT_MCP_ACCESS_TOKEN`, but the tunnel path relies on server-side injection for discovery.

## Verification

```bash
curl -sS -H "Authorization: Bearer $JOBAGENT_MCP_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  http://127.0.0.1:3101/mcp
```

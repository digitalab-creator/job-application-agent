#!/usr/bin/env python3
"""Write one job-sheet row through the existing n8n Google Sheets credential. Does not print secrets."""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path

N8N = "http://127.0.0.1:5678"
ENV = Path("/opt/apps/n8n/.env")
CREDENTIAL = {"id": "UsVIraYKqvdQZt4b", "name": "or Google Sheets account"}
DOC = "REDACTED_SPREADSHEET_ID"
SHEET = "REDACTED_SHEET_GID"


def api_key() -> str:
    for line in ENV.read_text(encoding="utf-8").splitlines():
        if line.startswith("N8N_API_KEY="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("missing N8N_API_KEY")


def call(method: str, path: str, payload: dict | None = None) -> dict:
    headers = {"X-N8N-API-KEY": api_key()}
    data = None
    if payload is not None:
        data = json.dumps(payload).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(f"{N8N}{path}", data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        body = error.read().decode()[:500]
        raise SystemExit(f"n8n {method} {path} -> {error.code} {body}") from error


def workflow_body(path_name: str) -> dict:
    hook_id = str(uuid.uuid4())
    unwrap_id = str(uuid.uuid4())
    sheet_id = str(uuid.uuid4())
    return {
        "name": "temp mark job sheet row",
        "nodes": [
            {
                "id": hook_id,
                "name": "Webhook",
                "type": "n8n-nodes-base.webhook",
                "typeVersion": 2,
                "position": [0, 0],
                "webhookId": str(uuid.uuid4()),
                "parameters": {"httpMethod": "POST", "path": path_name, "responseMode": "lastNode", "options": {}},
            },
            {
                "id": unwrap_id,
                "name": "Unwrap",
                "type": "n8n-nodes-base.code",
                "typeVersion": 2,
                "position": [220, 0],
                "parameters": {
                    "jsCode": "const body = $json.body && typeof $json.body === 'object' ? $json.body : $json;\nreturn [{ json: body }];",
                },
            },
            {
                "id": sheet_id,
                "name": "Write Result",
                "type": "n8n-nodes-base.googleSheets",
                "typeVersion": 4.7,
                "position": [280, 0],
                "credentials": {"googleSheetsOAuth2Api": CREDENTIAL},
                "parameters": {
                    "operation": "update",
                    "documentId": {"__rl": True, "value": DOC, "mode": "id"},
                    "sheetName": {"__rl": True, "value": SHEET, "mode": "id"},
                    "columns": {
                        "mappingMode": "defineBelow",
                        "matchingColumns": ["row_number"],
                        "value": {
                            "row_number": "={{ $json.row_number }}",
                            "Status": "={{ $json.Status }}",
                            "Notes": "={{ $json.Notes }}",
                            "Applied Date": "={{ $json['Applied Date'] }}",
                            "Job URL": "={{ $json['Job URL'] }}",
                        },
                        "schema": [
                            {"id": "Status", "displayName": "Status", "required": False, "defaultMatch": False, "display": True, "type": "string", "canBeUsedToMatch": True},
                            {"id": "Applied Date", "displayName": "Applied Date", "required": False, "defaultMatch": False, "display": True, "type": "string", "canBeUsedToMatch": True},
                            {"id": "Notes", "displayName": "Notes", "required": False, "defaultMatch": False, "display": True, "type": "string", "canBeUsedToMatch": True},
                            {"id": "Job URL", "displayName": "Job URL", "required": False, "defaultMatch": False, "display": True, "type": "string", "canBeUsedToMatch": True},
                            {"id": "row_number", "displayName": "row_number", "required": False, "defaultMatch": False, "display": True, "type": "number", "canBeUsedToMatch": True, "readOnly": True},
                        ],
                        "attemptToConvertTypes": False,
                        "convertFieldsToString": True,
                    },
                    "options": {},
                },
            },
        ],
        "connections": {
            "Webhook": {"main": [[{"node": "Unwrap", "type": "main", "index": 0}]]},
            "Unwrap": {"main": [[{"node": "Write Result", "type": "main", "index": 0}]]},
        },
        "settings": {"executionOrder": "v1"},
    }


def mark(row_number: int, status: str, notes: str, job_url: str, applied_date: str = "") -> None:
    path_name = f"mark-job-row-{uuid.uuid4().hex[:8]}"
    created = call("POST", "/api/v1/workflows", workflow_body(path_name))
    wf_id = created.get("id")
    if not wf_id:
        raise SystemExit(f"workflow create failed: {list(created)[:8]}")
    try:
        call("POST", f"/api/v1/workflows/{wf_id}/activate")
        body = json.dumps({
            "row_number": row_number,
            "Status": status,
            "Notes": notes,
            "Job URL": job_url,
            "Applied Date": applied_date,
        }).encode()
        req = urllib.request.Request(
            f"{N8N}/webhook/{path_name}",
            data=body,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            print(resp.read().decode()[:300])
    finally:
        try:
            call("POST", f"/api/v1/workflows/{wf_id}/deactivate")
        except SystemExit:
            pass
        call("DELETE", f"/api/v1/workflows/{wf_id}")


def main() -> None:
    payload = json.loads(sys.stdin.read())
    mark(
        int(payload["row_number"]),
        str(payload["Status"]),
        str(payload["Notes"]),
        str(payload["Job URL"]),
        str(payload.get("Applied Date") or ""),
    )


if __name__ == "__main__":
    main()

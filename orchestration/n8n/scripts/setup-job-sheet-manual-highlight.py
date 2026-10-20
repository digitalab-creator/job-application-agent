#!/usr/bin/env python3
"""Add Manual-row highlight nodes to Apply to jobs (daily) workflow. Idempotent via workflow staticData."""
from __future__ import annotations

import json
import sys
import uuid
import urllib.error
import urllib.request
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(AGENT_ROOT / "scripts"))
from n8n_orchestration import N8N_API_BASE, WORKFLOW_EXPORT_DIR, read_n8n_api_key  # noqa: E402

EXPORT = WORKFLOW_EXPORT_DIR / "wf-fcYSvcG7IiP8xAqr.json"
WORKFLOW_ID = "fcYSvcG7IiP8xAqr"

SPREADSHEET_ID = "YOUR_GOOGLE_SPREADSHEET_ID"
SHEET_ID = 0
RULE_VERSION = 1

ENSURE_CODE = f"""const staticData = $getWorkflowStaticData('global');
const RULE_VERSION = {RULE_VERSION};
if (staticData.jobSheetManualHighlightRuleV === RULE_VERSION) {{
  return [{{ json: {{ skipped: true }} }}];
}}
staticData.jobSheetManualHighlightRuleV = RULE_VERSION;
return [{{ json: {{ skipped: false, spreadsheetId: '{SPREADSHEET_ID}', sheetId: {SHEET_ID} }} }}];
"""

HTTP_JSON_BODY = (
    '={{ JSON.stringify({ requests: [{ addConditionalFormatRule: { rule: { ranges: [{ sheetId: '
    f"{SHEET_ID}, startRowIndex: 1, endRowIndex: 5000, startColumnIndex: 0, endColumnIndex: 17 }}], "
    'booleanRule: { condition: { type: "CUSTOM_FORMULA", values: [{ userEnteredValue: \'=$O2="Manual"\' }] }, '
    "format: { backgroundColor: { red: 1, green: 0.898, blue: 0.6 }, textFormat: { bold: true } } } }, "
    "index: 0 } }] }) }}"
)


def api(method: str, path: str, payload: dict | None = None) -> dict:
    headers = {"X-N8N-API-KEY": read_n8n_api_key()}
    data = None
    if payload is not None:
        data = json.dumps(payload).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(f"{N8N_API_BASE}{path}", data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.load(resp)


def node_ids() -> tuple[str, str, str]:
    return str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())


def patch_workflow(wf: dict) -> bool:
    names = {"Ensure Manual row highlight", "Manual highlight needed?", "Sheets Manual row highlight rule"}
    if all(any(n.get("name") == name for n in wf.get("nodes", [])) for name in names):
        return False

    ensure_id, if_id, http_id = node_ids()
    wf["nodes"].extend(
        [
            {
                "parameters": {"jsCode": ENSURE_CODE},
                "id": ensure_id,
                "name": "Ensure Manual row highlight",
                "type": "n8n-nodes-base.code",
                "typeVersion": 2,
                "position": [980, 100],
                "executeOnce": True,
            },
            {
                "parameters": {
                    "conditions": {
                        "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict"},
                        "conditions": [
                            {
                                "id": str(uuid.uuid4()),
                                "leftValue": "={{ $json.skipped }}",
                                "rightValue": False,
                                "operator": {"type": "boolean", "operation": "equals"},
                            }
                        ],
                        "combinator": "and",
                    },
                    "options": {},
                },
                "id": if_id,
                "name": "Manual highlight needed?",
                "type": "n8n-nodes-base.if",
                "typeVersion": 2.2,
                "position": [1180, 100],
            },
            {
                "parameters": {
                    "method": "POST",
                    "url": f"https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}:batchUpdate",
                    "authentication": "predefinedCredentialType",
                    "nodeCredentialType": "googleSheetsOAuth2Api",
                    "sendBody": True,
                    "specifyBody": "json",
                    "jsonBody": HTTP_JSON_BODY,
                    "options": {"response": {"response": {"neverError": True}}},
                },
                "id": http_id,
                "name": "Sheets Manual row highlight rule",
                "type": "n8n-nodes-base.httpRequest",
                "typeVersion": 4.2,
                "position": [1380, 40],
                "executeOnce": True,
                "continueOnFail": True,
                "credentials": {
                    "googleSheetsOAuth2Api": {
                        "id": "REPLACE_N8N_CREDENTIAL_ID",
                        "name": "or Google Sheets account",
                    }
                },
            },
        ]
    )

    conn = wf.setdefault("connections", {})
    conn["Sync Exclude to Worker"] = {"main": [[{"node": "Ensure Manual row highlight", "type": "main", "index": 0}]]}
    conn["Ensure Manual row highlight"] = {
        "main": [[{"node": "Manual highlight needed?", "type": "main", "index": 0}]]
    }
    conn["Manual highlight needed?"] = {
        "main": [
            [{"node": "Sheets Manual row highlight rule", "type": "main", "index": 0}],
            [{"node": "Read Jobs", "type": "main", "index": 0}],
        ]
    }
    conn["Sheets Manual row highlight rule"] = {
        "main": [[{"node": "Read Jobs", "type": "main", "index": 0}]]
    }
    return True


def put_payload(wf: dict) -> dict:
    allowed = (
        "executionOrder",
        "timezone",
        "saveDataErrorExecution",
        "saveDataSuccessExecution",
        "saveManualExecutions",
        "callerPolicy",
        "errorWorkflow",
        "availableInMCP",
    )
    payload = {
        "name": wf["name"],
        "nodes": wf["nodes"],
        "connections": wf["connections"],
        "settings": {k: v for k, v in wf.get("settings", {}).items() if k in allowed},
    }
    if "staticData" in wf:
        payload["staticData"] = wf["staticData"]
    return payload


def apply_manual_highlight_rule_now() -> None:
    """Install conditional format on the Jobs sheet."""
    import subprocess

    cred_id = "REPLACE_N8N_CREDENTIAL_ID"
    tmp_path = "/tmp/n8n-sheet-cred-export.json"
    try:
        subprocess.run(
            [
                "docker",
                "exec",
                "n8n",
                "n8n",
                "export:credentials",
                f"--id={cred_id}",
                "--decrypted",
                f"--output={tmp_path}",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        cat = subprocess.run(
            ["docker", "exec", "n8n", "cat", tmp_path],
            check=True,
            capture_output=True,
            text=True,
        )
        raw = json.loads(cat.stdout)
        cred = raw[0] if isinstance(raw, list) else raw
        oauth = cred.get("data", {}).get("oauthTokenData") or cred.get("oauthTokenData") or {}
        access = oauth.get("access_token")
        if not access:
            print("setup-job-sheet-manual-highlight: no access_token; rule will install on next apply run")
            return
        body = {
            "requests": [
                {
                    "addConditionalFormatRule": {
                        "rule": {
                            "ranges": [
                                {
                                    "sheetId": SHEET_ID,
                                    "startRowIndex": 1,
                                    "endRowIndex": 5000,
                                    "startColumnIndex": 0,
                                    "endColumnIndex": 17,
                                }
                            ],
                            "booleanRule": {
                                "condition": {
                                    "type": "CUSTOM_FORMULA",
                                    "values": [{"userEnteredValue": '=$O2="Manual"'}],
                                },
                                "format": {
                                    "backgroundColor": {"red": 1, "green": 0.898, "blue": 0.6},
                                    "textFormat": {"bold": True},
                                },
                            },
                        },
                        "index": 0,
                    }
                }
            ]
        }
        req = urllib.request.Request(
            f"https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}:batchUpdate",
            data=json.dumps(body).encode(),
            method="POST",
            headers={
                "Authorization": f"Bearer {access}",
                "Content-Type": "application/json",
            },
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            resp.read()
        print("setup-job-sheet-manual-highlight: conditional format rule applied on Jobs sheet")
    except (urllib.error.URLError, subprocess.CalledProcessError, json.JSONDecodeError, KeyError) as err:
        print(f"setup-job-sheet-manual-highlight: could not apply rule now ({err}); next apply run will try")
    finally:
        subprocess.run(
            ["docker", "exec", "n8n", "rm", "-f", tmp_path],
            capture_output=True,
            text=True,
        )


def main() -> None:
    force_rule = "--install-rule" in sys.argv
    live = api("GET", f"/workflows/{WORKFLOW_ID}")
    changed = patch_workflow(live)
    if not changed:
        print("setup-job-sheet-manual-highlight: nodes already present on live workflow")
    else:
        api("PUT", f"/workflows/{WORKFLOW_ID}", put_payload(live))
        print("setup-job-sheet-manual-highlight: live workflow updated")

    if changed or force_rule:
        apply_manual_highlight_rule_now()

    export = json.loads(EXPORT.read_text(encoding="utf-8"))
    if patch_workflow(export):
        EXPORT.write_text(json.dumps(export, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print("setup-job-sheet-manual-highlight: export JSON updated")
    else:
        print("setup-job-sheet-manual-highlight: export already had nodes")


if __name__ == "__main__":
    main()

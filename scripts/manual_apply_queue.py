#!/usr/bin/env python3
"""Export jobs that need a human finish (CAPTCHA challenge, login gate) from the worker ledger."""

from __future__ import annotations

import argparse
import html
import json
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
LEDGER = ROOT / "data/ledger/applications.jsonl"
OUT_DIR = ROOT / "data/manual-queue"
TZ = ZoneInfo("Asia/Jerusalem")

REASON_LABEL = {
    "captcha": "CAPTCHA (visible challenge)",
    "login_required": "Login / account gate",
}


def read_jsonl(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    rows: list[dict] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows


def row_on_day(at: str, day: str) -> bool:
    if not at:
        return False
    if str(at).startswith(day):
        return True
    try:
        dt = datetime.fromisoformat(str(at).replace("Z", "+00:00"))
        return dt.astimezone(TZ).strftime("%Y-%m-%d") == day
    except ValueError:
        return False


def latest_by_url(rows: list[dict]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for row in rows:
        url = str(row.get("url") or "").strip()
        if not url:
            continue
        out[url] = row
    return out


def is_manual_queue_row(row: dict) -> bool:
    if row.get("confirmationDetected"):
        return False
    blocker = str(row.get("blocker") or "").strip()
    if blocker == "login_required":
        return True
    if blocker == "captcha":
        return row.get("captchaSignal") == "active_challenge"
    return False


def apply_url(row: dict) -> str:
    return str(row.get("canonicalJobUrl") or row.get("url") or "").strip()


def reason_label(row: dict) -> str:
    blocker = str(row.get("blocker") or "manual")
    base = REASON_LABEL.get(blocker, blocker)
    signal = row.get("captchaSignal")
    stage = row.get("stage")
    extra: list[str] = []
    if signal:
        extra.append(str(signal))
    if stage:
        extra.append(str(stage))
    if extra:
        return f"{base} ({', '.join(extra)})"
    return base


def load_manual_queue(*, ledger_path: Path = LEDGER) -> list[dict]:
    latest = latest_by_url(read_jsonl(ledger_path))
    pending = [row for row in latest.values() if is_manual_queue_row(row)]
    pending.sort(key=lambda r: str(r.get("at", "")))
    return pending


def format_answers(row: dict, max_items: int = 6) -> list[str]:
    answers = row.get("answers")
    if not isinstance(answers, list):
        return []
    lines: list[str] = []
    for item in answers[:max_items]:
        if not isinstance(item, dict):
            continue
        q = str(item.get("question") or "").strip()
        a = str(item.get("answer") or "").strip()
        if q and a:
            lines.append(f"**{q[:120]}** → {a[:160]}")
    if isinstance(answers, list) and len(answers) > max_items:
        lines.append(f"_…and {len(answers) - max_items} more answers in ledger JSON_")
    return lines


def print_markdown(items: list[dict], *, day: str | None = None) -> None:
    title_day = day or datetime.now(TZ).strftime("%Y-%m-%d")
    print(f"## Manual apply queue ({len(items)} pending)")
    if day:
        added = [r for r in items if row_on_day(str(r.get("at", "")), day)]
        print(f"_Filtered to entries last updated on **{day}** ({len(added)} rows)._")
    if not items:
        print("- Nothing in the manual queue. Auto-apply can keep running.")
        print()
        return
    print(
        "Open each apply link, attach the CV path shown, paste screening answers if listed. "
        "Finish in a normal browser (not headless)."
    )
    print()
    for index, row in enumerate(items, start=1):
        company = str(row.get("company") or "?")
        role = str(row.get("role") or "?")
        url = apply_url(row)
        cv = str(row.get("cvPath") or "—")
        at = str(row.get("at") or "")[:19]
        print(f"### {index}. {company} — {role}")
        print(f"- **Reason:** {reason_label(row)}")
        print(f"- **Apply:** [{url}]({url})")
        print(f"- **CV:** `{cv}`")
        print(f"- **Queued at:** {at}")
        for line in format_answers(row):
            print(f"- {line}")
        print()


def write_html(items: list[dict], out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cards: list[str] = []
    for row in items:
        company = html.escape(str(row.get("company") or "?"))
        role = html.escape(str(row.get("role") or "?"))
        url = html.escape(apply_url(row))
        cv = html.escape(str(row.get("cvPath") or ""))
        reason = html.escape(reason_label(row))
        answer_bits = "".join(
            f"<li>{html.escape(line.replace('**', '').replace('** → ', ': '))}</li>"
            for line in format_answers(row)
        )
        answers_block = f"<ul class=\"answers\">{answer_bits}</ul>" if answer_bits else ""
        cards.append(
            f"""<article class="card">
  <h2>{company}</h2>
  <p class="role">{role}</p>
  <p class="reason">{reason}</p>
  <p><a class="btn" href="{url}" target="_blank" rel="noopener">Open application</a></p>
  <p class="cv"><span>CV</span> <code>{cv or "—"}</code></p>
  {answers_block}
</article>"""
        )
    body = "\n".join(cards) if cards else "<p>No pending manual jobs.</p>"
    doc = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Manual apply queue</title>
  <style>
    :root {{ font-family: system-ui, sans-serif; line-height: 1.45; }}
    body {{ margin: 0 auto; max-width: 40rem; padding: 1rem; }}
    h1 {{ font-size: 1.25rem; }}
    .card {{ border: 1px solid #ccc; border-radius: 8px; padding: 1rem; margin: 1rem 0; }}
    .role {{ margin: 0.25rem 0; font-weight: 600; }}
    .reason {{ color: #444; font-size: 0.95rem; }}
    .btn {{
      display: inline-block; padding: 0.65rem 1rem; background: #111; color: #fff;
      text-decoration: none; border-radius: 6px; font-weight: 600;
    }}
    .cv {{ font-size: 0.85rem; word-break: break-all; }}
    .cv span {{ font-weight: 600; }}
    .answers {{ font-size: 0.85rem; padding-left: 1.1rem; }}
  </style>
</head>
<body>
  <h1>Manual apply queue ({len(items)})</h1>
  <p>Tap <strong>Open application</strong>, upload the CV, submit. Blessings of the FSM upon yer tabs.</p>
  {body}
</body>
</html>"""
    out_path.write_text(doc, encoding="utf-8")


def jerusalem_today() -> str:
    return datetime.now(TZ).strftime("%Y-%m-%d")


def main() -> int:
    parser = argparse.ArgumentParser(description="Manual apply queue from worker ledger")
    parser.add_argument("day", nargs="?", help="Optional YYYY-MM-DD — only rows updated that day")
    parser.add_argument("--json", action="store_true", help="Print JSON array to stdout")
    parser.add_argument("--html", action="store_true", help=f"Write {OUT_DIR}/<day>.html")
    parser.add_argument("--ledger", type=Path, default=LEDGER, help="Override ledger path")
    args = parser.parse_args()

    items = load_manual_queue(ledger_path=args.ledger)
    if args.day:
        items = [r for r in items if row_on_day(str(r.get("at", "")), args.day)]

    day = args.day or jerusalem_today()
    if args.json:
        print(json.dumps(items, ensure_ascii=False, indent=2))
    else:
        print_markdown(items, day=args.day)

    if args.html:
        out = OUT_DIR / f"{day}.html"
        write_html(items if not args.day else load_manual_queue(ledger_path=args.ledger), out)
        if not args.json:
            print(f"_HTML queue (all pending): `{out}`_\n")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

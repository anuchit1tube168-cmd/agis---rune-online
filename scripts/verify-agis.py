#!/usr/bin/env python3
from __future__ import annotations
import json
import sqlite3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "agis" / "SOURCE_MANIFEST.json"
DB = ROOT / "agis" / "game-content.sqlite"
REQUIRED = [
    ROOT / "LICENSE",
    ROOT / "assets" / "CREDITS.md",
    ROOT / "AGENTS.md",
    ROOT / "SKILL.md",
    ROOT / "docs" / "AGIS-ARCHITECTURE.md",
    ROOT / "docs" / "CLOUDFLARE-DEPLOYMENT.md",
    ROOT / "wrangler.toml",
]

expected = {
    "items": 473,
    "jobs": 40,
    "meta": 11,
    "mobs": 43,
    "pets": 10,
    "skill_tree": 40,
    "skills": 311,
    "tables": 7,
}
expected_total = sum(expected.values())

errors: list[str] = []
for p in REQUIRED:
    if not p.exists():
        errors.append(f"missing required file: {p.relative_to(ROOT)}")

manifest = None
if not MANIFEST.exists():
    errors.append("missing agis/SOURCE_MANIFEST.json")
else:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    if manifest.get("version") != "2.6.0":
        errors.append(f"unexpected upstream version: {manifest.get('version')}")
    if manifest.get("archive_commit") != "c7a566e7752f51cdf31952d080ba5de387ab53c9":
        errors.append("upstream commit differs from the recorded v2.6.0 baseline")
    if manifest.get("content_counts") != expected:
        errors.append(f"manifest content counts differ: got={manifest.get('content_counts')} expected={expected}")
    if manifest.get("content_total") != expected_total:
        errors.append(f"manifest content total differs: got={manifest.get('content_total')} expected={expected_total}")

if not DB.exists():
    errors.append("missing agis/game-content.sqlite")
else:
    try:
        con = sqlite3.connect(DB)
        integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            errors.append(f"sqlite integrity_check: {integrity}")
        counts = dict(con.execute("SELECT category, COUNT(*) FROM content GROUP BY category"))
        if counts != expected:
            errors.append(f"content counts differ: got={counts} expected={expected}")
        total = con.execute("SELECT COUNT(*) FROM content").fetchone()[0]
        if total != expected_total:
            errors.append(f"content total differs: got={total} expected={expected_total}")
        con.close()
    except Exception as exc:
        errors.append(f"sqlite verification failed: {exc}")

if errors:
    print("AGIS verification: FAILED")
    for e in errors:
        print(f"- {e}")
    sys.exit(1)

print("AGIS verification: OK")
print("upstream: natthphong/rune-online v2.6.0 @ c7a566e7752f51cdf31952d080ba5de387ab53c9")
print(f"content catalog: {expected_total} records across {len(expected)} categories")

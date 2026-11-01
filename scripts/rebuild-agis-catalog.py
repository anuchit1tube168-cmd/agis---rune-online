#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "shared" / "data"
AGIS = ROOT / "agis"
DB = AGIS / "game-content.sqlite"
MANIFEST = AGIS / "SOURCE_MANIFEST.json"
UPSTREAM_COMMIT = "c7a566e7752f51cdf31952d080ba5de387ab53c9"
VERSION = "2.6.0"
CATEGORIES = ("items", "jobs", "meta", "mobs", "pets", "skill_tree", "skills", "tables")


def record_key(category: str, key, value) -> str:
    if key is not None:
        return str(key)
    if category in {"items", "mobs", "skills"}:
        return str(value["id"])
    if category == "pets":
        return str(value["mobId"])
    raise ValueError(f"No record-key rule for {category}")


def iter_records(category: str, payload):
    if isinstance(payload, dict):
        for key, value in payload.items():
            yield record_key(category, key, value), value
    elif isinstance(payload, list):
        for value in payload:
            yield record_key(category, None, value), value
    else:
        raise TypeError(f"Unsupported top-level JSON type for {category}: {type(payload).__name__}")


def build_db() -> dict[str, int]:
    AGIS.mkdir(parents=True, exist_ok=True)
    if DB.exists():
        DB.unlink()
    con = sqlite3.connect(DB)
    con.execute("PRAGMA journal_mode=DELETE")
    con.execute("PRAGMA synchronous=FULL")
    con.execute(
        """CREATE TABLE content (
            category TEXT NOT NULL,
            record_key TEXT NOT NULL,
            payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
            source_path TEXT NOT NULL,
            PRIMARY KEY(category, record_key)
        )"""
    )
    counts: dict[str, int] = {}
    for category in CATEGORIES:
        source = DATA / f"{category}.json"
        payload = json.loads(source.read_text(encoding="utf-8"))
        rows = []
        for key, value in iter_records(category, payload):
            rows.append((category, key, json.dumps(value, ensure_ascii=False), f"shared/data/{category}.json"))
        con.executemany(
            "INSERT INTO content(category, record_key, payload_json, source_path) VALUES (?,?,?,?)",
            rows,
        )
        counts[category] = len(rows)
    con.commit()
    integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
    con.close()
    if integrity != "ok":
        raise RuntimeError(f"SQLite integrity check failed: {integrity}")
    return counts


def is_upstream_snapshot_path(rel: str) -> bool:
    excluded_prefixes = (".git/", ".github/", ".ai/", "agis/", "docs/", "scripts/")
    excluded_files = {"AGENTS.md", "SKILL.md", "wrangler.toml"}
    return not rel.startswith(excluded_prefixes) and rel not in excluded_files


def build_manifest(counts: dict[str, int]) -> None:
    files = []
    for path in sorted(p for p in ROOT.rglob("*") if p.is_file()):
        rel = path.relative_to(ROOT).as_posix()
        if not is_upstream_snapshot_path(rel):
            continue
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        files.append({"path": rel, "sha256": digest, "bytes": path.stat().st_size})
    payload = {
        "source_repository": "https://github.com/natthphong/rune-online",
        "version": VERSION,
        "archive_commit": UPSTREAM_COMMIT,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "content_counts": counts,
        "content_total": sum(counts.values()),
        "snapshot_file_count": len(files),
        "files": files,
    }
    MANIFEST.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    counts = build_db()
    build_manifest(counts)
    print("AGIS content catalog rebuilt")
    print(json.dumps(counts, sort_keys=True))
    print(f"total={sum(counts.values())}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Patch the pinned Multica migration runner to resolve TaskFlow objects locally."""

from __future__ import annotations

import hashlib
from pathlib import Path


EXPECTED_SHA256 = "4b28acf027d238bcd16ab307e3ffedbdd896506e30a392bc56a4cc8401d03384"
SOURCE_PATH = Path("/src/server/cmd/migrate/main.go")
REPLACEMENTS = (
    ('IndexRegclass: "public.idx_comment_content_bigm",', 'IndexRegclass: "taskflow.idx_comment_content_bigm",'),
    ('TableRegclass: "public.comment",', 'TableRegclass: "taskflow.comment",'),
)


def patch_migration_runner_text(source: str) -> str:
    for original, replacement in REPLACEMENTS:
        count = source.count(original)
        if count != 1:
            raise ValueError(f"expected one exact migration-runner marker, found {count}: {original}")
        source = source.replace(original, replacement, 1)
    if "public." in source:
        raise ValueError("TaskFlow migration runner still contains an explicit public schema reference")
    return source


def patch_migration_runner(path: Path = SOURCE_PATH) -> None:
    original = path.read_bytes()
    actual_sha256 = hashlib.sha256(original).hexdigest()
    if actual_sha256 != EXPECTED_SHA256:
        raise ValueError(f"pinned Multica migration runner SHA256 changed: {actual_sha256}")
    patched = patch_migration_runner_text(original.decode("utf-8"))
    path.write_text(patched)
    print("TASKFLOW_MIGRATION_RUNNER_BOUNDARY=PASS public refs=0 schema=taskflow")


if __name__ == "__main__":
    try:
        patch_migration_runner()
    except (OSError, UnicodeError, ValueError) as exc:
        raise SystemExit(f"TASKFLOW_MIGRATION_RUNNER_BOUNDARY=FAIL {exc}")

#!/usr/bin/env python3
"""Stage pinned Multica migrations behind the TaskFlow schema firewall.

The vendor snapshot is never edited. This script copies the full migration set,
applies only reviewed TaskFlow-owned transforms, and refuses any staged SQL
that reaches a protected schema.
"""

from __future__ import annotations

import argparse
import hashlib
import re
import shutil
import sys
from pathlib import Path


EXPECTED_UP_MIGRATION_COUNT = 590
EXPECTED_DOWN_MIGRATION_COUNT = 590

# These hashes pin the exact upstream migration inputs for each TaskFlow-owned
# staging transform. A changed vendor file must be reviewed before staging.
EXPECTED_SOURCE_SHA256 = {
    "001_init.up.sql": "88bbaf79a586d195cc5d9c770f6b0aaa53cbc5a663672b594c759ede3d38784e",
    "032_issue_search_index.down.sql": "c153e72ee3caed5574bbccf5d8e7a2f732089a0f667b3eef57a1ec43f419b064",
    "032_issue_search_index.up.sql": "c6a2e7bc7d7cb8f35c824c94866ff60aa34d8a19e3bf79f647b0381570b39842",
    "076_task_usage_pgcron_extension.up.sql": "11ecc37183b303cbd52af4398b83b998f832f3b6f29d419ce1e0c68197c9b761",
    "076_task_usage_pgcron_extension.down.sql": "65b573f4bf91ced94e39df6646aadce17f72fbc6373c8b65e63dec14ac417da0",
    "102_task_usage_hourly_pipeline.down.sql": "88f597bef77cd0742a3276223702d686bb2d4310515feba6d1de55ae2c3d9984",
    "103_drop_legacy_daily_rollups.up.sql": "589cc75bfdad9b425eed8f12ae58a3d741af9e7b27bda72099023d3060fcd7f7",
    "137_search_index_pg_trgm_extension.up.sql": "b3f58dde4ec8956d3d89917e92eef662e2b1d3dea295b5c7e90fe67ff4973e3d",
}

PGCRON_CREATE_BLOCK = b"""DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'pg_cron extension not available; skipping. Schedule rollup_task_usage_daily() via your platform''s scheduling primitive (Kubernetes CronJob, etc.).';
END
$$;"""

PGBIGM_CREATE_BLOCK = b"""DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_bigm;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_bigm not available, skipping bigram indexes';
END
$$;"""

LEGACY_DAILY_CRON_CLEANUP = b"""DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.unschedule('rollup_task_usage_daily')
          FROM cron.job WHERE jobname = 'rollup_task_usage_daily';
        PERFORM cron.unschedule('rollup_task_usage_dashboard_daily')
          FROM cron.job WHERE jobname = 'rollup_task_usage_dashboard_daily';
    END IF;
END
$$;"""

LEGACY_DAILY_SINGLE_CRON_CLEANUP = b"""DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.unschedule('rollup_task_usage_daily')
          FROM cron.job WHERE jobname = 'rollup_task_usage_daily';
    END IF;
END
$$;"""

LEGACY_HOURLY_CRON_CLEANUP = b"""DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.unschedule('rollup_task_usage_hourly')
          FROM cron.job WHERE jobname = 'rollup_task_usage_hourly';
    END IF;
END
$$;"""

PGCRYPTO_EXTENSION = b'CREATE EXTENSION IF NOT EXISTS "pgcrypto";'
PGTRGM_EXTENSION = b"CREATE EXTENSION IF NOT EXISTS pg_trgm;"
PGBIGM_EXTENSION_DROP = b"DROP EXTENSION IF EXISTS pg_bigm;"

PGCRYPTO_ASSERTION = b"""DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_extension e
          JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
         WHERE e.extname = 'pgcrypto' AND n.nspname = 'extensions'
    ) THEN
        RAISE EXCEPTION 'TaskFlow requires pgcrypto preinstalled in extensions';
    END IF;
END
$$;"""

PGTRGM_ASSERTION = b"""DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_extension e
          JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
         WHERE e.extname = 'pg_trgm' AND n.nspname = 'extensions'
    ) THEN
        RAISE EXCEPTION 'TaskFlow requires pg_trgm preinstalled in extensions';
    END IF;
END
$$;"""

PGBIGM_OPTIONAL_GUARD = b"""DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_extension e
          JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
         WHERE e.extname = 'pg_bigm' AND n.nspname IN ('taskflow', 'extensions')
    ) THEN
        RAISE NOTICE 'pg_bigm is not preinstalled in an allowed schema; skipping optional bigram indexes';
    END IF;
END
$$;"""

TRANSFORMS: dict[str, tuple[tuple[bytes, bytes], ...]] = {
    "001_init.up.sql": ((PGCRYPTO_EXTENSION, PGCRYPTO_ASSERTION),),
    "032_issue_search_index.down.sql": ((PGBIGM_EXTENSION_DROP, b"-- TaskFlow rollback never drops a shared pg_bigm extension.\n"),),
    "032_issue_search_index.up.sql": ((PGBIGM_CREATE_BLOCK, PGBIGM_OPTIONAL_GUARD),),
    "076_task_usage_pgcron_extension.up.sql": ((PGCRON_CREATE_BLOCK, b"-- TaskFlow defers usage scheduling to a TaskFlow-owned scheduler.\n"),),
    "076_task_usage_pgcron_extension.down.sql": ((LEGACY_DAILY_SINGLE_CRON_CLEANUP, b"-- TaskFlow has no legacy Multica daily cron job to unschedule.\n"),),
    "102_task_usage_hourly_pipeline.down.sql": ((LEGACY_HOURLY_CRON_CLEANUP, b"-- TaskFlow has no legacy Multica hourly cron job to unschedule.\n"),),
    "103_drop_legacy_daily_rollups.up.sql": ((LEGACY_DAILY_CRON_CLEANUP, b"-- TaskFlow is a fresh schema; legacy Multica daily cron jobs do not exist here.\n"),),
    "137_search_index_pg_trgm_extension.up.sql": ((PGTRGM_EXTENSION, PGTRGM_ASSERTION),),
}

FORBIDDEN_SCHEMAS = ("public", "lab_multica", "cron", "auth", "storage", "realtime", "private")
QUALIFIED_SCHEMA_RE = re.compile(
    r"(?i)(?<![A-Za-z0-9_$])(?:\"?(" + "|".join(FORBIDDEN_SCHEMAS) + r")\"?)\s*\."
)
SCHEMA_DDL_RE = re.compile(
    r"(?i)\b(?:CREATE|ALTER|DROP)\s+SCHEMA\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?\"?("
    + "|".join(FORBIDDEN_SCHEMAS)
    + r")\"?\b"
)
SCHEMA_PRIVILEGE_RE = re.compile(
    r"(?i)\b(?:GRANT|REVOKE)\b[^;]*?\bON\s+SCHEMA\s+\"?("
    + "|".join(FORBIDDEN_SCHEMAS)
    + r")\"?\b"
)
SEARCH_PATH_RE = re.compile(r"(?i)\b(?:SET\s+(?:LOCAL\s+|SESSION\s+)?search_path|set_config\s*\(\s*'search_path')")
PGCATALOG_WRITE_RE = re.compile(
    r"(?i)\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+"
    r"(?:pg_catalog\s*\.\s*)?pg_(?:class|namespace|proc|extension|database|roles|authid|tablespace)\b"
)


def strip_sql_comments(sql: str) -> str:
    """Remove SQL comments without treating comment markers inside strings as comments."""
    out: list[str] = []
    i = 0
    state = "normal"
    dollar_tag = ""
    block_depth = 0
    while i < len(sql):
        if state == "normal":
            if sql.startswith("--", i):
                out.extend("  ")
                i += 2
                state = "line"
                continue
            if sql.startswith("/*", i):
                out.extend("  ")
                i += 2
                state = "block"
                block_depth = 1
                continue
            if sql[i] == "'":
                out.append(sql[i])
                i += 1
                state = "single"
                continue
            if sql[i] == '"':
                out.append(sql[i])
                i += 1
                state = "double"
                continue
            if sql[i] == "$":
                match = re.match(r"\$[A-Za-z_][A-Za-z_0-9]*\$|\$\$", sql[i:])
                if match:
                    dollar_tag = match.group(0)
                    out.append(dollar_tag)
                    i += len(dollar_tag)
                    state = "dollar"
                    continue
            out.append(sql[i])
            i += 1
            continue

        if state == "line":
            if sql[i] == "\n":
                out.append("\n")
                state = "normal"
            else:
                out.append(" ")
            i += 1
            continue

        if state == "block":
            if sql.startswith("/*", i):
                block_depth += 1
                out.extend("  ")
                i += 2
            elif sql.startswith("*/", i):
                block_depth -= 1
                out.extend("  ")
                i += 2
                if block_depth == 0:
                    state = "normal"
            else:
                out.append("\n" if sql[i] == "\n" else " ")
                i += 1
            continue

        if state == "single":
            out.append(sql[i])
            if sql[i] == "'":
                if i + 1 < len(sql) and sql[i + 1] == "'":
                    out.append(sql[i + 1])
                    i += 2
                else:
                    state = "normal"
                    i += 1
            else:
                i += 1
            continue

        if state == "double":
            out.append(sql[i])
            if sql[i] == '"':
                if i + 1 < len(sql) and sql[i + 1] == '"':
                    out.append(sql[i + 1])
                    i += 2
                else:
                    state = "normal"
                    i += 1
            else:
                i += 1
            continue

        if state == "dollar":
            if sql.startswith(dollar_tag, i):
                out.append(dollar_tag)
                i += len(dollar_tag)
                state = "normal"
            else:
                out.append(sql[i])
                i += 1
    return "".join(out)


def firewall_errors(filename: str, sql: str) -> list[str]:
    active = strip_sql_comments(sql)
    errors: list[str] = []
    for match in QUALIFIED_SCHEMA_RE.finditer(active):
        errors.append(f"{filename}: qualified access to forbidden schema {match.group(1)}")
    for match in SCHEMA_DDL_RE.finditer(active):
        errors.append(f"{filename}: schema DDL targets forbidden schema {match.group(1)}")
    for match in SCHEMA_PRIVILEGE_RE.finditer(active):
        errors.append(f"{filename}: schema privilege statement targets forbidden schema {match.group(1)}")
    if SEARCH_PATH_RE.search(active):
        errors.append(f"{filename}: migration changes search_path outside the TaskFlow role contract")
    if PGCATALOG_WRITE_RE.search(active):
        errors.append(f"{filename}: direct PostgreSQL system catalog write")
    if re.search(r"(?i)\b(?:CREATE|ALTER|DROP)\s+EXTENSION\b", active):
        errors.append(f"{filename}: extension DDL is forbidden in TaskFlow migrations")
    return errors


def transform_file(filename: str, source: bytes) -> bytes:
    if filename not in TRANSFORMS:
        return source
    digest = hashlib.sha256(source).hexdigest()
    expected = EXPECTED_SOURCE_SHA256[filename]
    if digest != expected:
        raise ValueError(f"{filename}: upstream SHA256 changed; review the TaskFlow staging transform")
    staged = source
    for old, new in TRANSFORMS[filename]:
        count = staged.count(old)
        if count != 1:
            raise ValueError(f"{filename}: expected one exact transform marker, found {count}")
        staged = staged.replace(old, new, 1)
    return staged


def stage_migrations(source_dir: Path, output_dir: Path) -> tuple[int, int, int]:
    if not source_dir.is_dir():
        raise ValueError(f"migration source directory not found: {source_dir}")
    source_files = sorted(p for p in source_dir.iterdir() if p.is_file() and p.suffix == ".sql")
    up_count = sum(p.name.endswith(".up.sql") for p in source_files)
    down_count = sum(p.name.endswith(".down.sql") for p in source_files)
    if up_count != EXPECTED_UP_MIGRATION_COUNT or down_count != EXPECTED_DOWN_MIGRATION_COUNT:
        raise ValueError(f"unexpected migration set: {up_count} up / {down_count} down")
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True)
    changed = 0
    errors: list[str] = []
    for path in source_files:
        original = path.read_bytes()
        staged = transform_file(path.name, original)
        errors.extend(firewall_errors(path.name, staged.decode("utf-8")))
        if staged != original:
            changed += 1
        (output_dir / path.name).write_bytes(staged)
    if errors:
        raise ValueError("\n".join(errors))
    return up_count, down_count, changed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        up_count, down_count, changed = stage_migrations(args.source, args.output)
    except (OSError, ValueError) as exc:
        print(f"TASKFLOW_MIGRATION_FIREWALL=FAIL\n{exc}", file=sys.stderr)
        return 1
    print(
        "TASKFLOW_MIGRATION_FIREWALL=PASS "
        f"up={up_count} down={down_count} staged_overrides={changed} forbidden_refs=0"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

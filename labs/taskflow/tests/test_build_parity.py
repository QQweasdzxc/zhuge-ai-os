from __future__ import annotations

import os
import importlib.util
import hashlib
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


TASKFLOW = Path(__file__).resolve().parents[1]
REPO = TASKFLOW.parents[1]
NATIVE = REPO / "labs" / "multica"
STAGING_SCRIPT = TASKFLOW / "patches" / "stage-migrations.py"
STAGING_SPEC = importlib.util.spec_from_file_location("taskflow_stage_migrations", STAGING_SCRIPT)
STAGING = importlib.util.module_from_spec(STAGING_SPEC)
assert STAGING_SPEC.loader is not None
STAGING_SPEC.loader.exec_module(STAGING)
DB_BOUNDARY_SCRIPT = TASKFLOW / "patches" / "apply-taskflow-db-boundary.py"
DB_BOUNDARY_SPEC = importlib.util.spec_from_file_location("taskflow_db_boundary", DB_BOUNDARY_SCRIPT)
DB_BOUNDARY = importlib.util.module_from_spec(DB_BOUNDARY_SPEC)
assert DB_BOUNDARY_SPEC.loader is not None
DB_BOUNDARY_SPEC.loader.exec_module(DB_BOUNDARY)

ZHUGE_PUBLIC_FUNCTIONS = (
    "allocate_board_task_work_code",
    "board_instance_identity_immutable",
    "enforce_board_task_scope",
    "enforce_worktodo_workspace_scope",
    "rls_auto_enable",
    "set_updated_at",
    "worklog_alpha_list_qq",
    "worklog_rc1_list_source_events_qq",
    "worktodo_assign_work_code",
    "resolve_app_access",
    "is_app_access_approved",
)


class TaskFlowBuildParityTests(unittest.TestCase):
    def test_wrappers_copy_the_pinned_vendor_and_do_not_clone_application_source(self):
        for wrapper in ("Dockerfile.backend", "Dockerfile.web"):
            text = (TASKFLOW / wrapper).read_text()
            self.assertIn("COPY third_party/multica/ /src/", text)
            self.assertIn("8db6cfe19ae6fd5c35ec71bd8fea42a3ef3861ec", text)
            self.assertNotRegex(
                text,
                r"(?im)^\s*RUN\s+git\s+clone\s+https://github\.com/multica-ai/multica",
            )
            self.assertIn("labs/taskflow/overrides/", text)
            self.assertIn("labs/taskflow/patches/", text)
            self.assertIn("/src/LICENSE /src/NOTICE", text)
        backend = (TASKFLOW / "Dockerfile.backend").read_text()
        self.assertIn("postgresql-client", backend)
        self.assertIn("stage-migrations.py", backend)
        self.assertIn("apply-taskflow-db-boundary.py", backend)
        self.assertIn("/taskflow-staged-migrations/ ./migrations/", backend)
        self.assertIn("taskflow-entrypoint.sh", backend)
        self.assertIn("taskflow-migrate.sh", backend)
        self.assertIn('ENTRYPOINT ["./taskflow-entrypoint.sh"]', backend)
        entrypoint = (TASKFLOW / "overrides/taskflow-entrypoint.sh").read_text()
        self.assertIn("current_user <> 'taskflow_runtime'", entrypoint)
        self.assertIn("ARRAY['taskflow', 'extensions']", entrypoint)
        self.assertIn("'public', 'lab_multica', 'cron'", entrypoint)
        self.assertIn("has_table_privilege(current_user, c.oid, protected_table_privilege)", entrypoint)
        self.assertIn("pg_catalog.pg_has_role", entrypoint)
        self.assertIn("must not have extensions CREATE", entrypoint)
        self.assertIn("has_sequence_privilege", entrypoint)
        self.assertIn("has_schema_privilege(current_user, 'cron', 'USAGE')", entrypoint)
        self.assertIn("relation ACL cannot be", entrypoint)
        self.assertNotIn("TaskFlow runtime has cron mutation privileges", entrypoint)
        self.assertNotIn("CREATE SCHEMA", entrypoint)
        self.assertNotIn("CREATE EXTENSION", entrypoint)
        self.assertIn('TASKFLOW_MIGRATE_BEFORE_START:-false', entrypoint)
        self.assertIn('./taskflow-migrate.sh', entrypoint)
        self.assertIn('unset TASKFLOW_MIGRATION_DATABASE_URL TASKFLOW_MIGRATE_BEFORE_START', entrypoint)
        self.assertLess(entrypoint.index('./taskflow-migrate.sh'), entrypoint.index('psql "$DATABASE_URL"'))
        self.assertNotIn("/app/migrate up", entrypoint)
        self.assertIn("exec /app/server", entrypoint)
        migrator = (TASKFLOW / "overrides/taskflow-migrate.sh").read_text()
        self.assertIn("current_user <> 'taskflow_migrator'", migrator)
        self.assertIn("TASKFLOW_MIGRATION_DATABASE_URL", migrator)
        self.assertIn("must not have extensions CREATE", migrator)
        self.assertIn("has_sequence_privilege", migrator)
        self.assertIn("has_schema_privilege(current_user, 'cron', 'USAGE')", migrator)
        self.assertIn("relation ACL cannot be", migrator)
        self.assertNotIn("TaskFlow migrator has cron mutation privileges", migrator)
        self.assertIn("exec /app/migrate up", migrator)

    def test_taskflow_overlay_isolated_from_native_overlay(self):
        exact_copies = ("dbid.go", "zhuge-help-launcher.tsx")
        for name in exact_copies:
            self.assertEqual(
                (TASKFLOW / "overrides" / name).read_bytes(),
                (NATIVE / "overrides" / name).read_bytes(),
                name,
            )
        native_identity_patch = (NATIVE / "patches/apply-zhuge-identity.py").read_text()
        taskflow_identity_patch = (TASKFLOW / "patches/apply-zhuge-identity.py").read_text()
        self.assertIn('r.With(authVerifyRL).Post("/auth/zhuge", h.ZhugeLogin)', taskflow_identity_patch)
        self.assertIn('r.Post("/api/cli-token", h.ZhugeIssueCliToken)', taskflow_identity_patch)
        self.assertIn("zhugeTaskFlowCliLogin(req)", taskflow_identity_patch)
        self.assertIn("proxy_text.count(proxy_signature) != 1", taskflow_identity_patch)
        self.assertIn('r.With(authVerifyRL).Post("/auth/zhuge", h.ZhugeLogin)', native_identity_patch)
        native_proxy = (REPO / "third_party/multica/apps/web/proxy.ts").read_text()
        self.assertIn("resolveLocaleFromSignals", native_proxy)
        self.assertNotIn("zhugeTaskFlowCliLogin", native_proxy)
        native_house_rules = (NATIVE / "patches/apply-zhuge-house-rules.py").read_text()
        taskflow_house_rules = (TASKFLOW / "patches/apply-zhuge-house-rules.py").read_text()
        self.assertEqual(
            taskflow_house_rules.replace(
                'copy_override("multica-brand-mark.tsx", "apps/web/components/zhuge-multica-brand.tsx")\n',
                "",
            ),
            native_house_rules,
        )
        taskflow_auth = (TASKFLOW / "overrides/zhuge_auth.go").read_text()
        self.assertIn('"/auth/v1/user"', taskflow_auth)
        self.assertIn("zhugePGUUID(identity.ID)", taskflow_auth)
        self.assertNotIn("/rest/v1/rpc/", taskflow_auth)
        self.assertNotIn("resolve_app_access", taskflow_auth)
        self.assertNotEqual(
            (TASKFLOW / "overrides/zhuge_auth.go").read_bytes(),
            (NATIVE / "overrides/zhuge_auth.go").read_bytes(),
            "TaskFlow Auth verifies the Zhuge session without calling Zhuge public RPCs",
        )

    def test_taskflow_runtime_sql_and_migrations_do_not_call_public_schema_or_zhuge_functions(self):
        code_suffixes = {".go", ".sql", ".js", ".mjs", ".ts", ".tsx", ".sh", ".py", ".html"}
        sources = [
            path
            for path in TASKFLOW.rglob("*")
            if path.is_file()
            and path.suffix in code_suffixes
            and "tests" not in path.relative_to(TASKFLOW).parts
            and path.name != "apply-taskflow-db-boundary.py"
        ]
        for path in sources:
            text = path.read_text(errors="replace")
            self.assertNotRegex(
                text,
                r"\bpublic\s*\.\s*[A-Za-z_][A-Za-z_0-9$]*",
                f"TaskFlow application source must not qualify Zhuge public objects: {path}",
            )
            for function_name in ZHUGE_PUBLIC_FUNCTIONS:
                explicit_reference = rf"(?i)(?:/rest/v1/rpc/|public\s*\.\s*){re.escape(function_name)}\b"
                self.assertNotRegex(
                    text,
                    explicit_reference,
                    f"TaskFlow application source must not call Zhuge public function {function_name}: {path}",
                )

        vendor_migrations = REPO / "third_party" / "multica" / "server" / "migrations"
        migration_runner = REPO / "third_party" / "multica" / "server" / "cmd" / "migrate" / "main.go"
        patched_runner = DB_BOUNDARY.patch_migration_runner_text(migration_runner.read_text())
        self.assertIn('IndexRegclass: "taskflow.idx_comment_content_bigm"', patched_runner)
        self.assertIn('TableRegclass: "taskflow.comment"', patched_runner)
        self.assertNotRegex(patched_runner, r"\bpublic\s*\.")
        self.assertEqual(hashlib.sha256(migration_runner.read_bytes()).hexdigest(), DB_BOUNDARY.EXPECTED_SHA256)
        with self.assertRaisesRegex(ValueError, "expected one exact migration-runner marker"):
            DB_BOUNDARY.patch_migration_runner_text("package main\n")

        vendor_runtime_sources = REPO / "third_party" / "multica" / "server"
        for path in vendor_runtime_sources.rglob("*.go"):
            if path.name.endswith("_test.go") or "migrations" in path.parts:
                continue
            text = path.read_text(errors="replace")
            if path == migration_runner:
                text = patched_runner
            self.assertNotRegex(
                text,
                r"\bpublic\s*\.",
                f"TaskFlow build source must not resolve Zhuge public objects: {path}",
            )
            for function_name in ZHUGE_PUBLIC_FUNCTIONS:
                self.assertNotRegex(
                    text,
                    rf"(?i)(?:/rest/v1/rpc/|public\s*\.\s*){re.escape(function_name)}\b",
                    f"TaskFlow build source must not call Zhuge public function {function_name}: {path}",
                )

        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "staged"
            STAGING.stage_migrations(vendor_migrations, output)
            for migration in output.glob("*.sql"):
                text = STAGING.strip_sql_comments(migration.read_text())
                self.assertNotRegex(
                    text,
                    r"(?i)\bpublic\s*\.\s*[A-Za-z_][A-Za-z_0-9$]*",
                    migration.name,
                )
                for function_name in ZHUGE_PUBLIC_FUNCTIONS:
                    self.assertNotRegex(
                        text,
                        rf"(?i)public\s*\.\s*{re.escape(function_name)}\b",
                        migration.name,
                    )

    def test_taskflow_ready_route_allows_only_configured_dev_shell_origins(self):
        route = (TASKFLOW / "overrides/zhuge-ready-route.ts").read_text()
        self.assertIn("TASKFLOW_ENTRY_ORIGINS", route)
        self.assertIn('"https://qqweasdzxc.github.io"', route)
        self.assertIn("new Set([PRODUCTION_SHELL_ORIGIN, ...configured])", route)
        self.assertIn("if (!origin || !allowedEntryOrigins().has(origin))", route)
        self.assertNotIn('"access-control-allow-origin": "*"', route)
        self.assertNotEqual(
            route,
            (NATIVE / "overrides/zhuge-ready-route.ts").read_text(),
            "TaskFlow Dev CORS config is TaskFlow-owned; Native Lab stays frozen",
        )

    def test_taskflow_replacement_pages_keep_multica_brand_and_attribution(self):
        for name in (
            "zhuge-root-page.tsx",
            "zhuge-login-page.tsx",
            "zhuge-handoff-page.tsx",
        ):
            text = (TASKFLOW / "overrides" / name).read_text()
            self.assertIn("MulticaBrandMark", text, name)
            self.assertIn("multica", text.lower(), name)
            self.assertIn("All rights reserved.", text, name)
            self.assertIn("https://github.com/multica-ai/multica", text, name)
        self.assertIn(
            "MulticaIcon",
            (TASKFLOW / "overrides/multica-brand-mark.tsx").read_text(),
        )

    def test_boundary_defaults_match_native_lab_and_keep_cloud_telemetry_off(self):
        backend = (TASKFLOW / "Dockerfile.backend").read_text()
        web = (TASKFLOW / "Dockerfile.web").read_text()
        self.assertIn("DISABLE_WORKSPACE_CREATION=true", backend)
        self.assertIn("MULTICA_CLOUD_URL=", backend)
        self.assertIn("DO_NOT_TRACK=1", backend)
        self.assertIn("ANALYTICS_DISABLED=true", backend)
        self.assertIn("NEXT_TELEMETRY_DISABLED=1", web)
        self.assertIn("NEXT_PUBLIC_ENABLE_CLOUD_RUNTIME=false", web)
        self.assertIn("REMOTE_API_URL=http://backend:8080", web)
        boundary = (TASKFLOW / "DB_BOUNDARY.md").read_text()
        self.assertIn("taskflow,extensions", boundary)
        self.assertIn("MIGRATION_BOUNDARY.md", boundary)

    def test_taskflow_staging_firewall_copies_complete_migration_set_and_neutralizes_legacy_cron(self):
        vendor_migrations = REPO / "third_party" / "multica" / "server" / "migrations"
        original_103_hash = hashlib.sha256(
            (vendor_migrations / "103_drop_legacy_daily_rollups.up.sql").read_bytes()
        ).hexdigest()
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "staged"
            up_count, down_count, changed = STAGING.stage_migrations(vendor_migrations, output)
            self.assertEqual((up_count, down_count, changed), (590, 590, 8))
            self.assertEqual(len(list(output.glob("*.up.sql"))), 590)
            self.assertEqual(len(list(output.glob("*.down.sql"))), 590)

            staged_103 = (output / "103_drop_legacy_daily_rollups.up.sql").read_text()
            self.assertNotIn("cron.unschedule", STAGING.strip_sql_comments(staged_103))
            self.assertNotIn("cron.job", STAGING.strip_sql_comments(staged_103))
            self.assertIn("DROP TABLE IF EXISTS task_usage_daily", staged_103)
            self.assertIn("task_usage_hourly_rollup_state", staged_103)

            staged_101 = (output / "101_task_usage_hourly_schema.up.sql").read_text()
            self.assertIn("CREATE TABLE task_usage_hourly", staged_101)
            staged_102 = (output / "102_task_usage_hourly_pipeline.up.sql").read_text()
            self.assertIn("CREATE OR REPLACE FUNCTION rollup_task_usage_hourly()", staged_102)
            self.assertIn("pgcrypto", (output / "001_init.up.sql").read_text())
            self.assertNotIn("CREATE EXTENSION", (output / "001_init.up.sql").read_text())
            self.assertNotIn("CREATE EXTENSION", (output / "137_search_index_pg_trgm_extension.up.sql").read_text())
            staged_032_down = (output / "032_issue_search_index.down.sql").read_text()
            self.assertNotIn("DROP EXTENSION", staged_032_down)
            self.assertIn("DROP INDEX IF EXISTS idx_issue_title_bigm", staged_032_down)

            for migration in output.glob("*.sql"):
                self.assertEqual(
                    STAGING.firewall_errors(migration.name, migration.read_text()),
                    [],
                    migration.name,
                )

        self.assertEqual(
            hashlib.sha256(
                (vendor_migrations / "103_drop_legacy_daily_rollups.up.sql").read_bytes()
            ).hexdigest(),
            original_103_hash,
        )

    def test_taskflow_migration_firewall_rejects_protected_schema_access(self):
        samples = (
            "ALTER TABLE public.app_users ADD COLUMN x text;",
            "SELECT * FROM lab_multica.issue;",
            "SELECT cron.unschedule('old_job') FROM cron.job;",
            "SET search_path = taskflow, public;",
            "CREATE SCHEMA auth;",
            "GRANT USAGE ON SCHEMA storage TO taskflow_runtime;",
            "DROP EXTENSION IF EXISTS pg_bigm;",
        )
        for sql in samples:
            with self.subTest(sql=sql):
                self.assertTrue(STAGING.firewall_errors("fixture.sql", sql))
        self.assertEqual(
            STAGING.firewall_errors("allowed.sql", "ALTER TABLE taskflow.issue ADD COLUMN x text;"),
            [],
        )

    def test_taskflow_migration_transform_fails_closed_if_upstream_marker_changes(self):
        with self.assertRaisesRegex(ValueError, "upstream SHA256 changed"):
            STAGING.transform_file(
                "103_drop_legacy_daily_rollups.up.sql",
                b"-- changed upstream migration\n",
            )

    def test_identity_patch_fails_closed_when_upstream_router_marker_is_missing(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "source"
            overrides = Path(temp) / "overrides"
            router = root / "server/cmd/server/router.go"
            router.parent.mkdir(parents=True)
            router.write_text("package server\n// expected auth route intentionally absent\n")
            overrides.mkdir()
            script = self._relocate_script(
                TASKFLOW / "patches/apply-zhuge-identity.py", root, overrides
            )
            result = subprocess.run(
                [sys.executable, str(script)], capture_output=True, text=True
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Multica router auth marker not found", result.stderr + result.stdout)

    def test_house_rules_patch_fails_closed_when_required_marker_is_missing(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "source"
            overrides = Path(temp) / "overrides"
            tmpdir = Path(temp) / "patch-inputs"
            router = root / "server/cmd/server/router.go"
            router.parent.mkdir(parents=True)
            router.write_text("package server\n// expected managed-only routes intentionally absent\n")
            tmpdir.mkdir()
            for name in (
                "zhuge-root-page.tsx",
                "zhuge-login-page.tsx",
                "zhuge-help-launcher.tsx",
                "multica-brand-mark.tsx",
            ):
                (tmpdir / name).write_text("// fixture\n")
            script = self._relocate_script(
                TASKFLOW / "patches/apply-zhuge-house-rules.py", root, tmpdir
            )
            result = subprocess.run(
                [sys.executable, str(script)], capture_output=True, text=True
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("marker missing", result.stderr + result.stdout)

    @staticmethod
    def _relocate_script(source: Path, root: Path, tmpdir: Path) -> Path:
        text = source.read_text()
        text = text.replace(
            'Path("/src/server/cmd/server/router.go")',
            f"Path({os.fspath(root / 'server/cmd/server/router.go')!r})",
        )
        text = text.replace('Path("/src")', f"Path({os.fspath(root)!r})")
        text = text.replace('Path("/tmp")', f"Path({os.fspath(tmpdir)!r})")
        relocated = tmpdir / source.name
        relocated.write_text(text)
        return relocated


if __name__ == "__main__":
    unittest.main()

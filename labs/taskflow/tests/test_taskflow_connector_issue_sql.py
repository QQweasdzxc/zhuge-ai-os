from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[3]
INSTALL = ROOT / "labs/taskflow/sql/issue42_connector_create_issue_candidate.sql"
ROLLBACK = ROOT / "labs/taskflow/sql/issue42_connector_create_issue_rollback.sql"
INTEGRATION = ROOT / "labs/taskflow/tests/issue42_postgres_assertions.sql"
RUNNER = ROOT / "labs/taskflow/tests/run_issue42_postgres_integration.sh"


class TaskFlowConnectorIssueSqlTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.sql = INSTALL.read_text()
        cls.rollback = ROLLBACK.read_text()

    def test_definer_boundary_is_narrow_and_fail_closed(self) -> None:
        self.assertEqual(self.sql.count("\nSECURITY DEFINER\n"), 2)
        self.assertNotIn("SECURITY INVOKER", self.sql)
        self.assertIn("SET search_path = pg_catalog, taskflow, extensions, pg_temp", self.sql)
        self.assertIn("session_user <> 'postgres' OR current_user <> 'taskflow_migrator'", self.sql)
        self.assertIn("session_user <> 'taskflow_migrator' OR current_user <> 'taskflow_migrator'", self.sql)
        self.assertIn("pg_catalog.pg_get_userbyid(n.nspowner)", self.sql)
        self.assertIn("refusing to replace Issue #42 function owned by %", self.sql)
        self.assertNotRegex(self.sql, r"\bpublic\s*\.")
        self.assertNotRegex(self.sql, r"\bGRANT\s+(?:ALL|SELECT|INSERT|UPDATE|DELETE).*(?:anon|authenticated|service_role|taskflow_runtime)\b")
        self.assertEqual(len(re.findall(r"GRANT EXECUTE ON FUNCTION .* TO postgres;", self.sql)), 2)
        self.assertEqual(len(re.findall(
            r"REVOKE ALL ON FUNCTION .*?FROM PUBLIC, anon, authenticated, service_role, taskflow_runtime, taskflow_migrator;",
            self.sql,
            flags=re.DOTALL,
        )), 2)
        self.assertIn("function security contract failed", self.sql)
        self.assertIn("application roles", self.sql)

    def test_create_path_preserves_native_issue_invariants(self) -> None:
        for marker in (
            "taskflow.sb_connector_create_issue",
            "'operation', 'create'",
            "taskflow.sb_connector_issue_request",
            "taskflow.project AS p",
            "taskflow.member AS m",
            "m.role = 'owner'",
            "s.archived_at IS NULL",
            "i.triage_state IS NULL",
            "s.category IN ('done', 'closed')",
            "ORDER BY i.created_at ASC",
            "'issue-active-duplicate|' || v_workspace_id::TEXT || '|'",
            "p_project_id::TEXT || '||'",
            "issue_counter = w.issue_counter + 1",
            "w.issue_prefix",
            "taskflow.issue_subscriber",
            "taskflow.activity_log",
            "'created'",
            "'request_id', p_request_id::TEXT",
            "ON CONFLICT ON CONSTRAINT issue_subscriber_pkey DO NOTHING",
        ):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.sql)

    def test_update_path_is_project_scoped_idempotent_and_revision_checked(self) -> None:
        self.assertIn("taskflow.sb_connector_update_issue", self.sql)
        self.assertIn("'operation', 'update'", self.sql)
        self.assertIn("AND i.project_id = p_project_id", self.sql)
        self.assertIn("i.revision = p_expected_revision", self.sql)
        self.assertIn("'status_changed'::TEXT", self.sql)
        self.assertIn("'priority_changed'::TEXT", self.sql)
        self.assertIn("i.id <> p_issue_id", self.sql)
        self.assertIn("active duplicate issue exists: %", self.sql)
        self.assertEqual(self.sql.count("hashtextextended('taskflow.sb_connector_create_issue:' || p_request_id::TEXT, 0)"), 2)

    def test_real_postgres_harness_uses_full_taskflow_migrations(self) -> None:
        self.assertTrue(INTEGRATION.exists())
        runner = RUNNER.read_text()
        self.assertIn("taskflow-migrate.sh", runner)
        self.assertIn("taskflow/sql/issue42_connector_create_issue_candidate.sql", runner)
        self.assertIn("issue42_postgres_assertions.sql", runner)
        self.assertIn("issue42_connector_create_issue_rollback.sql", runner)
        self.assertIn("Disposable postgres service only", runner)
        self.assertIn("ISSUE42_CONCURRENT_DUPLICATE=PASS", runner)

    def test_rollback_disables_functions_but_preserves_cards_and_ledger(self) -> None:
        self.assertIn("DROP FUNCTION IF EXISTS", self.rollback)
        self.assertIn("taskflow_migrator", self.rollback)
        self.assertNotRegex(self.rollback, r"\bDELETE\s+FROM\s+taskflow\.issue\b")
        self.assertNotRegex(self.rollback, r"\bDROP\s+TABLE\s+taskflow\.sb_connector_issue_request\b")
        self.assertIn("tombstone ledger", self.rollback)


if __name__ == "__main__":
    unittest.main()

from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[3]
INSTALL = ROOT / "labs/taskflow/sql/issue42_connector_create_issue_candidate.sql"
ROLLBACK = ROOT / "labs/taskflow/sql/issue42_connector_create_issue_rollback.sql"


class TaskFlowConnectorIssueSqlTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.sql = INSTALL.read_text()
        cls.rollback = ROLLBACK.read_text()

    def test_functions_are_taskflow_scoped_and_execute_is_connector_only(self) -> None:
        # The reviewed Issue #42 install runs as taskflow_migrator and creates
        # SECURITY DEFINER functions owned by that restricted role. Execution
        # is granted only to the trusted Connector login (postgres); the
        # function body independently verifies both session_user and
        # current_user so an application role cannot inherit this boundary.
        self.assertEqual(len(re.findall(r"^SECURITY DEFINER$", self.sql, re.MULTILINE)), 2)
        self.assertEqual(len(re.findall(r"^SECURITY INVOKER$", self.sql, re.MULTILINE)), 0)
        self.assertIn("SET search_path = pg_catalog, taskflow, extensions, pg_temp", self.sql)
        self.assertNotRegex(self.sql, r"\bpublic\s*\.")
        self.assertNotRegex(self.sql, r"GRANT\s+(?:ALL|SELECT|INSERT|UPDATE|DELETE).*\b(?:anon|authenticated|service_role|taskflow_runtime)\b")
        self.assertEqual(len(re.findall(r"GRANT EXECUTE ON FUNCTION .* TO postgres;", self.sql)), 2)
        revokes = re.findall(
            r"REVOKE ALL ON FUNCTION\s+taskflow\.sb_connector_(?:create|update)_issue\([^;]+;",
            self.sql,
            re.DOTALL,
        )
        self.assertEqual(len(revokes), 2)
        for role in ("PUBLIC", "anon", "authenticated", "service_role", "taskflow_runtime", "taskflow_migrator"):
            self.assertTrue(all(re.search(rf"\b{role}\b", revoke) for revoke in revokes), role)
        self.assertEqual(self.sql.count("session_user <> 'postgres' OR current_user <> 'taskflow_migrator'"), 2)
        self.assertIn("v_is_superuser OR v_bypass_rls", self.sql)
        self.assertIn("<> 'taskflow_migrator'", self.sql)

    def test_create_path_allocates_native_fields_and_durable_activity(self) -> None:
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

    def test_retries_and_update_use_payload_idempotency_and_revision_guard(self) -> None:
        self.assertIn("v_saved_payload <> v_payload", self.sql)
        self.assertIn("hashtextextended('taskflow.sb_connector_create_issue:' || p_request_id::TEXT, 0)", self.sql)
        self.assertIn("taskflow.sb_connector_update_issue", self.sql)
        self.assertIn("'operation', 'update'", self.sql)
        self.assertIn("AND i.project_id = p_project_id", self.sql)
        self.assertIn("i.revision = p_expected_revision", self.sql)
        self.assertIn("'status_changed'::TEXT", self.sql)
        self.assertIn("'priority_changed'::TEXT", self.sql)

    def test_rollback_disables_functions_but_preserves_cards_and_idempotency_ledger(self) -> None:
        self.assertIn("REVOKE ALL ON FUNCTION", self.rollback)
        self.assertIn("DROP FUNCTION", self.rollback)
        self.assertNotRegex(self.rollback, r"\bDELETE\s+FROM\s+taskflow\.issue\b")
        self.assertNotRegex(self.rollback, r"\bDROP\s+TABLE\s+taskflow\.sb_connector_issue_request\b")


if __name__ == "__main__":
    unittest.main()

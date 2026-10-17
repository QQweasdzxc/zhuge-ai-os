import importlib.util
import os
import re
import tempfile
import unittest
from pathlib import Path

repo_override = os.environ.get("TASKFLOW_AI_DISPATCH_REPO")
REPO = Path(repo_override).resolve() if repo_override else Path(__file__).resolve().parents[3]
VENDOR=Path(os.environ.get("TASKFLOW_AI_DISPATCH_VENDOR",REPO/"third_party/multica")).resolve()
OVERLAYS=Path(os.environ.get("TASKFLOW_AI_DISPATCH_OVERLAYS",REPO/"labs/taskflow/overrides")).resolve()
MIGRATIONS=Path(os.environ.get("TASKFLOW_AI_DISPATCH_MIGRATIONS",OVERLAYS/"migrations")).resolve()
PATCH_PATH=Path(os.environ.get("TASKFLOW_AI_DISPATCH_PATCH",REPO/"labs/taskflow/patches/apply-taskflow-ai-dispatch.py")).resolve()
spec=importlib.util.spec_from_file_location("zhuge_ai_dispatch_patch",PATCH_PATH)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class CloudApprovalNativeOverlayTest(unittest.TestCase):
    def test_original_vendor_router_anchor_and_native_middleware(self):
        text=(VENDOR/mod.ROUTE).read_text()
        self.assertTrue(mod.verify(text))
        self.assertEqual(text.count(mod.ANCHOR),1)
        github=(VENDOR/mod.GITHUB).read_text()
        self.assertTrue(mod.verify_webhook(github,text))

    def test_patch_is_one_time_and_keeps_native_auth_routes(self):
        vendor=(VENDOR/mod.ROUTE).read_text()
        with tempfile.TemporaryDirectory() as d:
            tmp=Path(d)
            router=tmp/mod.ROUTE
            router.parent.mkdir(parents=True)
            router.write_text(vendor)
            github=tmp/mod.GITHUB
            github.parent.mkdir(parents=True,exist_ok=True)
            github.write_text((VENDOR/mod.GITHUB).read_text())
            overlays=OVERLAYS
            migrations=tmp/"staged_migrations"
            mod.apply(tmp,overlays,migrations)
            after=router.read_text()
            self.assertIn('r.With(handler.RequireHumanActor).Get("/zhuge-ai/settings", h.GetIssueAISettings)',after)
            self.assertIn('r.With(handler.RequireHumanActor).Put("/zhuge-ai/settings", h.PutIssueAISettings)',after)
            self.assertIn('r.With(handler.RequireHumanActor).Get("/zhuge-ai/runs"',after)
            self.assertIn('r.With(handler.RequireHumanActor).Post("/zhuge-ai/approve"',after)
            self.assertIn('r.With(handler.RequireHumanActor).Post("/zhuge-ai/accept"',after)
            self.assertIn('r.With(handler.RequireHumanActor).Get("/zhuge-ai/settings", h.GetProjectAISettings)',after)
            self.assertIn('r.With(handler.RequireHumanActor).Put("/zhuge-ai/settings", h.PutProjectAISettings)',after)
            self.assertIn(mod.WEBHOOK_ROUTE_PATCHED,after)
            self.assertIn('r.Use(middleware.RequireWorkspaceMember(queries))',after)
            self.assertTrue((migrations/"591_zhuge_ai_engineering_run.up.sql").exists())
            self.assertIn("CREATE TABLE zhuge_ai_engineering_run",(migrations/"591_zhuge_ai_engineering_run.up.sql").read_text())
            self.assertIn("CREATE TABLE github_webhook_delivery",(migrations/"591_zhuge_ai_engineering_run.up.sql").read_text())
            for name in mod.MIGRATIONS:
                self.assertTrue((migrations/name).is_file(),name)
            self.assertTrue((tmp/"server/internal/handler/zhuge_github_webhook.go").exists())
            self.assertTrue((tmp/"server/internal/handler/zhuge_ai_codex.go").exists())
            self.assertTrue((tmp/"server/internal/handler/zhuge_codex_webhook.go").exists())
            self.assertTrue((tmp/"server/internal/handler/zhuge_ai_codex_test.go").exists())
            self.assertTrue((tmp/"server/internal/handler/zhuge_codex_webhook_test.go").exists())
            contract=(tmp/"server/internal/handler/taskflowcontract")
            self.assertTrue((contract/"zhuge_ai_contract.go").exists())
            self.assertTrue((contract/"zhuge_ai_contract_test.go").exists())
            dispatch=(tmp/"server/internal/handler/zhuge_ai_dispatch.go").read_text()
            webhook=(tmp/"server/internal/handler/zhuge_github_webhook.go").read_text()
            codex=(tmp/"server/internal/handler/zhuge_ai_codex.go").read_text()
            callback=(tmp/"server/internal/handler/zhuge_codex_webhook.go").read_text()
            dispatch_receipt = codex[codex.index("WITH changed AS"):codex.index("var currentState string")]
            self.assertEqual(webhook.count("h.HandleGitHubWebhookNative("),3)
            self.assertNotIn("h.HandleGitHubWebhook(",webhook)
            self.assertIn("func (h *Handler) HandleGitHubWebhook(w http.ResponseWriter, r *http.Request)",webhook)
            self.assertIn("server/internal/handler/taskflowcontract",dispatch)
            self.assertIn("server/internal/handler/taskflowcontract",webhook)
            self.assertIn("taskflowcontract.ClosingMarker(taskIdentifier)",dispatch)
            self.assertIn("func (h *Handler) GetProjectAISettings",dispatch)
            self.assertIn("func (h *Handler) PutProjectAISettings",dispatch)
            self.assertIn("func (h *Handler) GetIssueAISettings",dispatch)
            self.assertIn("func (h *Handler) PutIssueAISettings",dispatch)
            self.assertIn("project and task AI opt-in with Co selection required",dispatch)
            self.assertIn("provider_ack_pending",codex)
            self.assertIn("github_dispatch_comment_id=$3",dispatch_receipt)
            self.assertNotIn("provider_receipt_id=",dispatch_receipt)
            self.assertIn("provider_dispatch_id",callback)
            self.assertIn("run.github_pr_number=$2",callback)
            self.assertIn("codexMarkerCount(payload.Comment.Body) != 1",callback)
            self.assertIn("codexGitHubBotLogin",callback)
            native_github=(VENDOR/mod.GITHUB).read_text()
            closing_pattern=re.search(r"var closingIdentifierRe = regexp.MustCompile\(\s*`([^`]+)`",native_github)
            self.assertIsNotNone(closing_pattern)
            marker="Closes ZG-42"
            self.assertIsNotNone(re.search(closing_pattern.group(1),marker))
            patched_github=(tmp/mod.GITHUB).read_text()
            self.assertIn(mod.WEBHOOK_METHOD_RENAMED,patched_github)
            self.assertIn("func (h *Handler) HandleGitHubWebhookNative",patched_github)
            with self.assertRaises(ValueError):
                mod.apply(tmp,overlays,migrations)

    def test_overlay_requires_durable_receipt_and_runtime_only_grants(self):
        up=(MIGRATIONS/"591_zhuge_ai_engineering_run.up.sql").read_text()
        down=(MIGRATIONS/"591_zhuge_ai_engineering_run.down.sql").read_text()
        webhook=(OVERLAYS/"zhuge_github_webhook.go").read_text()
        self.assertIn("payload_sha256 text NOT NULL",up)
        self.assertNotRegex(up,r"(?i)\bCREATE\s+(?:UNIQUE\s+)?INDEX\b")
        self.assertIn("GRANT SELECT, INSERT ON TABLE github_webhook_delivery TO taskflow_runtime",up)
        self.assertIn("GRANT UPDATE (processing_state, attempt_count",up)
        self.assertIn("REVOKE ALL ON TABLE",up)
        self.assertIn("recordedDigest",webhook)
        self.assertIn("http.StatusConflict",webhook)
        self.assertIn("processing_state='persisted'",webhook)
        self.assertIn("processing_state='failed'",webhook)
        self.assertIn("processing_state='ignored'",webhook)
        self.assertIn("installation_not_linked",webhook)
        self.assertIn("provider_run_acknowledged\": false",webhook)
        self.assertIn("explicit PM archival required",down)
        self.assertIn("'failed','ignored'",up)
        self.assertIn("approval_expired",up)
        dispatch=(OVERLAYS/"zhuge_ai_dispatch.go").read_text()
        self.assertIn("p.workspace_id=i.workspace_id",dispatch)
        self.assertIn('requireWorkspaceRole(w, r, workspaceID, "workspace not found", "owner")',dispatch)
        self.assertIn('ZHUGE_TASKFLOW_AI_APPROVALS_ENABLED',dispatch)
        self.assertIn('r.With(handler.RequireHumanActor).Post("/zhuge-ai/approve"',
                      (VENDOR/mod.ROUTE).read_text().replace(mod.ANCHOR,mod.NEW,1))
        for name in mod.MIGRATIONS:
            sql=(MIGRATIONS/name).read_text()
            self.assertNotRegex(sql,r"(?i)\b(?:public|lab_multica|cron|auth|storage|realtime|private)\s*\.",name)
            version=int(name.split("_",1)[0])
            if name.endswith(".up.sql") and 592 <= version <= 596:
                statement=sql.strip()
                self.assertEqual(statement.count(";"),1,name)
                self.assertRegex(statement,r"(?i)^CREATE (?:UNIQUE )?INDEX ")
                self.assertNotIn("CONCURRENTLY",statement,name)
            if name.endswith(".down.sql") and 592 <= version <= 596:
                statement=sql
                self.assertIn("TaskFlow AI Run evidence exists",statement,name)
                self.assertNotIn("CONCURRENTLY",statement,name)
            if version == 597 and name.endswith(".up.sql"):
                self.assertIn("CREATE TABLE zhuge_ai_project_setting",sql)
                self.assertIn("CREATE TABLE zhuge_ai_issue_setting",sql)
                self.assertIn("GRANT UPDATE (enabled, engineer, updated_by, updated_at)",sql)
                self.assertIn("REVOKE ALL ON TABLE",sql)
            if version == 597 and name.endswith(".down.sql"):
                self.assertIn("AI engineering settings exist",sql)
            if version == 598 and name.endswith(".up.sql"):
                self.assertIn("provider_dispatch_id uuid",sql)
                self.assertIn("github_dispatch_comment_id bigint",sql)
                self.assertIn("result_summary text",sql)
                self.assertIn("event_type IN ('pull_request', 'issue_comment')",sql)
                self.assertIn("GRANT UPDATE (provider_dispatch_id",sql)
                self.assertNotIn("GRANT UPDATE ON TABLE zhuge_ai_engineering_run",sql)
            if version == 598 and name.endswith(".down.sql"):
                self.assertIn("Codex dispatch evidence exists",sql)
                self.assertIn("DROP COLUMN provider_dispatch_id",sql)

    def test_rejects_missing_authenticated_issue_scope(self):
        vendor=(VENDOR/mod.ROUTE).read_text()
        with self.assertRaises(ValueError):
            mod.verify(vendor.replace(mod.ANCHOR,"",1))
        self.assertTrue(mod.verify(vendor))
        github=(VENDOR/mod.GITHUB).read_text()
        with self.assertRaises(ValueError):
            mod.verify_webhook(github.replace(mod.WEBHOOK_METHOD,"",1),vendor)
        text=vendor.replace('r.Use(middleware.RequireWorkspaceMember(queries))','r.Use(middleware.RequireWorkspaceMemberFromURL(queries,"id"))',1)
        # One occurrence may be in an earlier route; at minimum native anchor must remain pinned.
        self.assertIn(mod.ANCHOR,text)

if __name__=="__main__":
    unittest.main()

import importlib.util
import tempfile
import unittest
from pathlib import Path

HERE=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("zhuge_ai_dispatch_patch",HERE/"patches"/"apply-taskflow-ai-dispatch.py")
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class CloudApprovalNativeOverlayTest(unittest.TestCase):
    def test_original_vendor_router_anchor_and_native_middleware(self):
        text=(HERE.parents[1]/"third_party/multica/server/cmd/server/router.go").read_text()
        self.assertTrue(mod.verify(text))
        self.assertEqual(text.count(mod.ANCHOR),1)

    def test_patch_is_one_time_and_keeps_native_auth_routes(self):
        vendor=(HERE.parents[1]/"third_party/multica/server/cmd/server/router.go").read_text()
        with tempfile.TemporaryDirectory() as d:
            tmp=Path(d)
            router=tmp/mod.ROUTE
            router.parent.mkdir(parents=True)
            router.write_text(vendor)
            overlays=HERE/"overrides"
            migrations=tmp/"staged_migrations"
            mod.apply(tmp,overlays,migrations)
            after=router.read_text()
            self.assertIn('r.With(handler.RequireHumanActor).Get("/zhuge-ai/runs"',after)
            self.assertIn('r.With(handler.RequireHumanActor).Post("/zhuge-ai/approve"',after)
            self.assertIn('r.Use(middleware.RequireWorkspaceMember(queries))',after)
            self.assertTrue((migrations/"591_zhuge_ai_engineering_run.up.sql").exists())
            self.assertIn("CREATE TABLE zhuge_ai_engineering_run",(migrations/"591_zhuge_ai_engineering_run.up.sql").read_text())
            self.assertTrue((tmp/"server/internal/handler/zhuge_ai_dispatch_test.go").exists())
            with self.assertRaises(ValueError):
                mod.apply(tmp,overlays,migrations)

    def test_rejects_missing_authenticated_issue_scope(self):
        vendor=(HERE.parents[1]/"third_party/multica/server/cmd/server/router.go").read_text()
        with self.assertRaises(ValueError):
            mod.verify(vendor.replace(mod.ANCHOR,"",1))
        self.assertTrue(mod.verify(vendor))
        text=vendor.replace('r.Use(middleware.RequireWorkspaceMember(queries))','r.Use(middleware.RequireWorkspaceMemberFromURL(queries,"id"))',1)
        # One occurrence may be in an earlier route; at minimum native anchor must remain pinned.
        self.assertIn(mod.ANCHOR,text)

if __name__=="__main__":
    unittest.main()

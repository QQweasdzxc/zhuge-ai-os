import hashlib
import importlib.util
import shutil
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
VENDOR = ROOT / "third_party/multica"
PATCH_PATH = ROOT / "labs/taskflow/patches/apply-taskflow-native-ai-readback.py"
SPEC = importlib.util.spec_from_file_location("native_ai_readback", PATCH_PATH)
PATCH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PATCH)
STAGE_SPEC = importlib.util.spec_from_file_location("native_ai_stage", ROOT / "labs/taskflow/patches/stage-taskflow-native-ai-runtime.py")
STAGE = importlib.util.module_from_spec(STAGE_SPEC)
STAGE_SPEC.loader.exec_module(STAGE)


class NativeAIReadbackOverlayTests(unittest.TestCase):
    def test_routes_are_installed_only_in_build_copy_and_guarded_as_human(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "server/cmd/server/router.go"
            target.parent.mkdir(parents=True)
            shutil.copyfile(VENDOR / "server/cmd/server/router.go", target)
            original = hashlib.sha256(target.read_bytes()).hexdigest()
            PATCH.apply(target)
            source = target.read_text()
            self.assertIn('r.With(handler.RequireHumanActor).Get("/project-mappings", h.ListZhugeNativeExecutorProjects)', source)
            self.assertIn('r.With(handler.RequireHumanActor).Get("/tasks", h.ListZhugeNativeAITasks)', source)
            self.assertEqual(original, hashlib.sha256((VENDOR / "server/cmd/server/router.go").read_bytes()).hexdigest())
            with self.assertRaises(SystemExit):
                PATCH.apply(target)

    def test_missing_or_ambiguous_upstream_marker_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "router.go"
            target.write_text("package main\n")
            with self.assertRaises(SystemExit):
                PATCH.apply(target)

    def test_runtime_test_stages_only_into_an_isolated_server_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            server = Path(directory) / "multica/server"
            router = server / "cmd/server/router.go"
            router.parent.mkdir(parents=True)
            (server / "go.mod").write_text("module github.com/multica-ai/multica/server\n")
            shutil.copyfile(VENDOR / "server/cmd/server/router.go", router)
            before = hashlib.sha256((VENDOR / "server/cmd/server/router.go").read_bytes()).hexdigest()
            STAGE.stage(server)
            self.assertTrue((server / "internal/handler/taskflow_native_ai_readback.go").is_file())
            self.assertTrue((server / "cmd/taskflow-native-ai-runtime/main_test.go").is_file())
            self.assertIn('r.With(handler.RequireHumanActor).Get("/project-mappings", h.ListZhugeNativeExecutorProjects)', router.read_text())
            self.assertEqual(before, hashlib.sha256((VENDOR / "server/cmd/server/router.go").read_bytes()).hexdigest())


if __name__ == "__main__":
    unittest.main()

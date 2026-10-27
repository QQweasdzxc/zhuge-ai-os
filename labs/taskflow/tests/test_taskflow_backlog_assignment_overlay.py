"""Planning-only agent assignment must not change native execution authority."""
import importlib.util
from pathlib import Path
import shutil
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[3]
PATCH = REPO / 'labs/taskflow/patches/apply-taskflow-ai-native-views.py'
SPEC = importlib.util.spec_from_file_location('native_ai', PATCH)
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)

class BacklogPlanningOverlayTests(unittest.TestCase):
    def test_exact_status_is_threaded_through_all_native_issue_pickers(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shutil.copytree(REPO/'third_party/multica/packages/views', root/'packages/views')
            MOD.patch_backlog_assignment(root, REPO/'labs/taskflow/overrides')
            picker = (root/'packages/views/issues/components/pickers/assignee-picker.tsx').read_text()
            self.assertIn('decision.allowed && (issueStatus === "backlog" || runtimeBound)', picker)
            self.assertIn('const runtimeBound = runnableAgentIds.has(s.leader_id)', picker)
            for path in (root/'packages/views').rglob('*.tsx'):
                if path.name.endswith('.test.tsx') or path.name == 'assignee-picker.tsx':
                    continue
                text = path.read_text()
                if '<AssigneePicker' in text:
                    self.assertEqual(text.count('<AssigneePicker'), text.count('issueStatus={'), str(path))
            batch=(root/'packages/views/issues/components/batch-action-toolbar.tsx').read_text()
            self.assertIn('selectedIssues.length > 0 && selectedIssues.every((issue) => issue.status === "backlog") ? "backlog" : undefined', batch)
            with self.assertRaises(ValueError):
                MOD.patch_backlog_assignment(root, REPO/'labs/taskflow/overrides')

    def test_native_execution_and_permission_files_are_not_mutated(self):
        text=PATCH.read_text()
        self.assertNotIn('server/internal', text)
        self.assertNotIn('core/permissions/rules.ts', text)
        self.assertNotIn('runtime-binding.ts', text)
        docker=(REPO/'labs/taskflow/Dockerfile.backend').read_text()
        self.assertIn('taskflow_backlog_assignment_test.go /src/server/internal/handler/',docker)
        gates=(REPO/'labs/taskflow/patches/run-parity-tests.sh').read_text()
        self.assertIn("run_gate backlog_planning 3",gates)
        self.assertIn("-run '^TestTaskFlowBacklog' -count=1",gates)

if __name__ == '__main__':
    unittest.main()

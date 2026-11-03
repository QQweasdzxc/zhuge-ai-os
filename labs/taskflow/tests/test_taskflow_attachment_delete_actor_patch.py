"""Attachment-delete actor overlay application contracts; run by unittest and pytest parity jobs."""
import importlib.util
from pathlib import Path
import tempfile
import shutil
import unittest

ROOT = Path(__file__).resolve().parents[3]
TASKFLOW = ROOT / 'labs/taskflow'
VENDOR = ROOT / 'third_party/multica'
SPEC = importlib.util.spec_from_file_location('attachment_delete_actor_patch', TASKFLOW / 'patches/apply-taskflow-attachment-delete-actor.py')
PATCH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PATCH)


class AttachmentDeleteActorPatchTests(unittest.TestCase):
    def fixture(self, root):
        dest = root / 'server/internal/handler/file.go'
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(VENDOR / 'server/internal/handler/file.go', dest)

    def test_apply_real_vendor_and_reapplication_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.fixture(root)
            PATCH.apply(root)
            built = (root / 'server/internal/handler/file.go').read_text()
            self.assertIn('actorType, actorID := h.resolveActor(r, userID, workspaceID)', built)
            self.assertEqual(built.count('EventIssueAttachmentsChanged, workspaceID, actorType, actorID'), 1)
            self.assertEqual(built.count('EventCommentUpdated, workspaceID, actorType, actorID'), 1)
            handler = built.split('func (h *Handler) DeleteAttachment')[1]
            self.assertNotIn('"member", userID', handler)
            with self.assertRaisesRegex(SystemExit, 'already patched'):
                PATCH.apply(root)

    def test_bad_anchor_fails_before_any_write(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.fixture(root)
            path = root / 'server/internal/handler/file.go'
            path.write_text(path.read_text().replace(
                '\t\th.publish(protocol.EventIssueAttachmentsChanged, workspaceID, "member", userID, map[string]any{\n',
                '// changed upstream', 1))
            before = path.read_bytes()
            with self.assertRaises(SystemExit):
                PATCH.apply(root)
            self.assertEqual(before, path.read_bytes())

    def test_build_wires_patch_and_tests(self):
        docker = (TASKFLOW / 'Dockerfile.backend').read_text()
        self.assertIn('RUN python3 /tmp/apply-taskflow-attachment-delete-actor.py --root /src', docker)
        self.assertIn('COPY labs/taskflow/tests/attachment_delete_actor_test.go', docker)


if __name__ == '__main__':
    unittest.main()

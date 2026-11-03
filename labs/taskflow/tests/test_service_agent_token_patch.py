"""SAT overlay application contracts; run by unittest and pytest parity jobs."""
import importlib.util
from pathlib import Path
import tempfile
import shutil
import unittest

ROOT = Path(__file__).resolve().parents[3]
TASKFLOW = ROOT / 'labs/taskflow'
VENDOR = ROOT / 'third_party/multica'
SPEC = importlib.util.spec_from_file_location('sat_patch', TASKFLOW / 'patches/apply-taskflow-service-agent-token.py')
PATCH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PATCH)


class ServiceAgentTokenPatchTests(unittest.TestCase):
    def fixture(self, root):
        for name in ('internal/middleware/auth.go', 'internal/middleware/workspace.go',
                     'internal/handler/handler.go', 'internal/handler/actor_guards.go',
                     'cmd/server/router.go'):
            dest = root / 'server' / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(VENDOR / 'server' / name, dest)
        (root / 'server/pkg/db/generated').mkdir(parents=True)

    def test_apply_real_vendor_and_reapplication_fails_without_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.fixture(root)
            PATCH.apply(root)
            files = {p.relative_to(root): p.read_bytes() for p in root.rglob('*.go')}
            self.assertEqual(len(files), 8)
            self.assertIn(b'authenticateServiceAgentToken(', files[Path('server/internal/middleware/auth.go')])
            router = files[Path('server/cmd/server/router.go')].decode()
            self.assertEqual(router.count('RequireHumanActor).Post("/service-tokens"'), 1)
            self.assertEqual(router.count('RequireHumanActor).Get("/service-tokens"'), 1)
            self.assertEqual(router.count('RequireHumanActor).Delete("/service-tokens/{tokenId}"'), 1)
            with self.assertRaisesRegex(SystemExit, 'already patched'):
                PATCH.apply(root)
            self.assertEqual(files, {p.relative_to(root): p.read_bytes() for p in root.rglob('*.go')})

    def test_bad_anchor_and_destination_fail_before_any_write(self):
        for failure in ('missing', 'ambiguous', 'collision'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                self.fixture(root)
                path = root / 'server/cmd/server/router.go'
                marker = '\t\t\t\tr.Route("/{id}", func(r chi.Router) {\n\t\t\t\t\tr.Get("/", h.GetAgent)'
                if failure == 'missing':
                    path.write_text(path.read_text().replace(marker, '// changed upstream'))
                elif failure == 'ambiguous':
                    path.write_text(path.read_text() + marker)
                else:
                    (root / 'server/internal/handler/taskflow_service_agent_token.go').write_text('collision')
                before = {p.relative_to(root): p.read_bytes() for p in root.rglob('*.go')}
                with self.assertRaises(SystemExit):
                    PATCH.apply(root)
                self.assertEqual(before, {p.relative_to(root): p.read_bytes() for p in root.rglob('*.go')})

    def test_symlink_escape_is_rejected_before_any_write(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.fixture(root)
            path = root / 'server/internal/middleware/auth.go'
            original = (VENDOR / 'server/internal/middleware/auth.go').read_bytes()
            path.unlink()  # Only the disposable fixture copy.
            path.symlink_to(VENDOR / 'server/internal/middleware/auth.go')
            with self.assertRaisesRegex(SystemExit, 'escapes disposable root'):
                PATCH.apply(root)
            self.assertEqual(original, (VENDOR / 'server/internal/middleware/auth.go').read_bytes())
            self.assertNotIn('service-tokens', (root / 'server/cmd/server/router.go').read_text())

    def test_missing_identity_strip_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.fixture(root)
            path = root / 'server/internal/middleware/auth.go'
            path.write_text(path.read_text().replace('r.Header.Del("X-Agent-ID")', '// upstream strip removed'))
            with self.assertRaisesRegex(SystemExit, 'identity strip marker changed'):
                PATCH.apply(root)

    def test_frozen_vendor_refused(self):
        with self.assertRaisesRegex(SystemExit, 'frozen'):
            PATCH.apply(VENDOR)

    def test_cli_patch_composes_with_sat(self):
        spec = importlib.util.spec_from_file_location('cli_patch', TASKFLOW / 'patches/patch-cli-auth-middleware.py')
        cli = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cli)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.fixture(root)
            path = root / 'server/internal/middleware/auth.go'
            path.write_text(cli.patch_cli_authorization_middleware_text(path.read_text()))
            PATCH.apply(root)
            self.assertIn('auth.ConsumeCLIAuthorizationCode(', path.read_text())
            self.assertIn('authenticateServiceAgentToken(', path.read_text())

    def test_build_wires_overlay_and_non_skippable_contracts(self):
        docker = (TASKFLOW / 'Dockerfile.backend').read_text()
        self.assertIn('RUN python3 /tmp/apply-taskflow-service-agent-token.py --root /src', docker)
        self.assertIn('COPY labs/taskflow/tests/service_agent_token_contract_test.go', docker)
        self.assertIn('sh /tmp/run-service-agent-token-tests.sh', (TASKFLOW / 'patches/run-parity-tests.sh').read_text())
        gate = (TASKFLOW / 'patches/run-service-agent-token-tests.sh').read_text()
        self.assertIn('"$got" -eq 10', gate)
        self.assertIn('candidate postflight', gate)

    def test_all_sql_paths_have_exact_shared_role_guard(self):
        guard = (TASKFLOW / 'sql/taskflow_migration_role_guard.sql').read_text().strip()
        for name in ('taskflow_service_agent_tokens_candidate.sql', 'taskflow_service_agent_tokens_postflight.sql',
                     'taskflow_service_agent_tokens_rollback.sql', 'taskflow_instinct01_service_agent_candidate.sql'):
            sql = (TASKFLOW / 'sql' / name).read_text()
            self.assertIn(guard, sql)
            self.assertLess(sql.index(guard), sql.index('SET LOCAL search_path'))


if __name__ == '__main__':
    unittest.main()

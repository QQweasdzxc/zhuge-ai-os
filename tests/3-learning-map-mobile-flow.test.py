import gzip
import importlib.util
import json
import pathlib
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('learning_delta', ROOT / 'tools/apply-learning-map-mobile-flow.py')
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)


class LearningDeltaTest(unittest.TestCase):
    def fixture(self, directory, corrupt_name=None):
        root = pathlib.Path(directory)
        data = {'release': 'learning-map-mobile-flow-20261122', 'files': {}, 'binary': {}, 'base_sha256': {}, 'sha256': {}, 'preserved': []}
        for name in MOD.EXPECTED:
            old = ('old:' + name).encode()
            new = ('new:' + name).encode()
            target = root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(old)
            data['base_sha256'][name] = MOD.hashlib.sha256(old).hexdigest()
            data['sha256'][name] = MOD.hashlib.sha256(new).hexdigest()
            data['files'][name] = new.decode()
        if corrupt_name:
            data['sha256'][corrupt_name] = '0' * 64
        bundle = root / 'fixture.json.gz'
        bundle.write_bytes(gzip.compress(json.dumps(data).encode(), mtime=0))
        return root, bundle

    def test_exact_scope_applies_and_records_digests(self):
        with tempfile.TemporaryDirectory() as temp:
            root, bundle = self.fixture(temp)
            data = MOD.apply(root, bundle)
            for name in MOD.EXPECTED:
                self.assertEqual(MOD.hashlib.sha256((root/name).read_bytes()).hexdigest(), data['sha256'][name])
            self.assertTrue((root/'map-mobile-flow-manifest.json').exists())
            with self.assertRaisesRegex(ValueError, 'Newer learning source'):
                MOD.apply(root, bundle)

    def test_one_changed_baseline_prevents_every_write(self):
        with tempfile.TemporaryDirectory() as temp:
            root, bundle = self.fixture(temp)
            (root/'island-world.js').write_text('newer unrelated route')
            before = {name: (root/name).read_bytes() for name in MOD.EXPECTED}
            with self.assertRaisesRegex(ValueError, 'Newer learning source'):
                MOD.apply(root, bundle)
            self.assertEqual(before, {name: (root/name).read_bytes() for name in MOD.EXPECTED})
            self.assertFalse((root/'map-mobile-flow-manifest.json').exists())

    def test_bad_payload_prevents_every_write(self):
        with tempfile.TemporaryDirectory() as temp:
            root, bundle = self.fixture(temp, 'island-world.js')
            before = {name: (root/name).read_bytes() for name in MOD.EXPECTED}
            with self.assertRaisesRegex(ValueError, 'payload digest mismatch'):
                MOD.apply(root, bundle)
            self.assertEqual(before, {name: (root/name).read_bytes() for name in MOD.EXPECTED})


if __name__ == '__main__':
    unittest.main()

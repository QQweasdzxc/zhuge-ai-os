"""Real PostgreSQL 17 restore test for the protected TaskFlow backup runner.

The normal TaskFlow unit suite skips this integration test when Docker or
PostgreSQL 17 client tools are unavailable. The dedicated Build Parity job sets
TASKFLOW_BACKUP_CI_REQUIRED=1, which converts missing prerequisites to failure.
All database content in this test is synthetic.
"""
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import time
import unittest
import uuid
from pathlib import Path

ROOT = Path(__file__).parents[1]
REPO = ROOT.parents[1]
RUNNER = ROOT / "overrides/issue42-backup-only.sh"


def command_exists(name):
    return shutil.which(name) is not None


class BackupRunnerPostgres17Test(unittest.TestCase):
    def test_runner_restores_and_encrypts_only_taskflow_schema(self):
        required = ("docker", "openssl", "age", "age-keygen", "pg_dump",
                    "pg_restore", "psql", "createdb")
        missing = [name for name in required if not command_exists(name)]
        if missing:
            if os.environ.get("TASKFLOW_BACKUP_CI_REQUIRED") == "1":
                self.fail("required PostgreSQL backup CI tools missing: " + ",".join(missing))
            self.skipTest("local backup integration prerequisites unavailable")

        pg_version = subprocess.run(
            ["pg_dump", "--version"], check=True, capture_output=True, text=True
        ).stdout
        if "PostgreSQL) 17." not in pg_version:
            if os.environ.get("TASKFLOW_BACKUP_CI_REQUIRED") == "1":
                self.fail("dedicated backup CI requires PostgreSQL 17 client")
            self.skipTest("local pg_dump is not PostgreSQL 17")

        token = uuid.uuid4().hex[:10]
        container = "taskflow-backup-" + token
        with tempfile.TemporaryDirectory(prefix="taskflow-backup-ci-") as temp:
            temp_path = Path(temp)
            tls = temp_path / "tls"
            tls.mkdir(mode=0o700)
            cert = tls / "server.crt"
            key = tls / "server.key"
            subprocess.run([
                "openssl", "req", "-x509", "-nodes", "-newkey", "rsa:2048",
                "-keyout", str(key), "-out", str(cert), "-days", "1",
                "-subj", "/CN=localhost",
                "-addext", "subjectAltName=DNS:localhost",
            ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            cert.chmod(0o644)
            key.chmod(0o600)
            subprocess.run([
                "docker", "run", "--rm", "--user", "0",
                "-v", f"{tls}:/tls",
                "postgres:17", "chown", "postgres:postgres", "/tls/server.key",
            ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)

            subprocess.run([
                "docker", "run", "--rm", "-d", "--name", container,
                "-e", "POSTGRES_PASSWORD=backup-ci-bootstrap",
                "-p", "127.0.0.1:5432:5432",
                "-v", f"{tls}:/tls:ro",
                "postgres:17",
                "-c", "ssl=on",
                "-c", "ssl_cert_file=/tls/server.crt",
                "-c", "ssl_key_file=/tls/server.key",
            ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
            try:
                ready = False
                for _ in range(60):
                    probe = subprocess.run(
                        ["docker", "exec", container, "pg_isready", "-U", "postgres", "-d", "postgres"],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                    )
                    if probe.returncode == 0:
                        ready = True
                        break
                    time.sleep(1)
                self.assertTrue(ready, "isolated PostgreSQL 17 did not become ready")

                bootstrap_sql = """
CREATE ROLE taskflow_migrator LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE
  PASSWORD 'backup-ci-migrator';
CREATE ROLE taskflow_runtime NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA taskflow AUTHORIZATION taskflow_migrator;
SET ROLE taskflow_migrator;
CREATE TABLE taskflow.issue (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO taskflow.issue(id, title) VALUES
  ('00000000-0000-4000-8000-000000000001', 'synthetic backup row one'),
  ('00000000-0000-4000-8000-000000000002', 'synthetic backup row two');
RESET ROLE;
GRANT SELECT ON taskflow.issue TO taskflow_runtime;
"""
                bootstrap = subprocess.run(
                    ["docker", "exec", "-i", "-e", "PGPASSWORD=backup-ci-bootstrap",
                     container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1",
                     "-U", "postgres", "-d", "postgres"],
                    input=bootstrap_sql, text=True, capture_output=True,
                )
                self.assertEqual(bootstrap.returncode, 0, "synthetic PostgreSQL bootstrap failed")

                identity = temp_path / "backup.agekey"
                keygen = subprocess.run(
                    ["age-keygen", "-o", str(identity)],
                    capture_output=True, text=True, check=True,
                )
                self.assertNotIn("AGE-SECRET-KEY-", keygen.stderr)
                identity.chmod(0o600)
                recipient = subprocess.run(
                    ["age-keygen", "-y", str(identity)],
                    capture_output=True, text=True, check=True,
                ).stdout.strip()
                self.assertTrue(recipient.startswith("age1"))

                source_service = (
                    "[taskflow_migrator]\n"
                    "host=localhost\nport=5432\ndbname=postgres\n"
                    "user=taskflow_migrator\npassword=backup-ci-migrator\n"
                    f"sslmode=verify-full\nsslrootcert={cert}\n"
                )
                restore_service = (
                    "[taskflow_restore]\n"
                    "host=127.0.0.1\nport=5432\ndbname=postgres\n"
                    "user=postgres\npassword=backup-ci-bootstrap\nsslmode=disable\n"
                )
                output_dir = temp_path / "output"
                runner_env = os.environ.copy()
                runner_env.update({
                    "TASKFLOW_MIGRATION_PG_SERVICE": "taskflow_migrator",
                    "TASKFLOW_MIGRATION_PGSERVICEFILE_CONTENT": source_service,
                    "TASKFLOW_BACKUP_RESTORE_PG_SERVICE": "taskflow_restore",
                    "TASKFLOW_BACKUP_RESTORE_PGSERVICEFILE_CONTENT": restore_service,
                    "TASKFLOW_BACKUP_AGE_RECIPIENT": recipient,
                    "TASKFLOW_BACKUP_EXPECTED_HOST": "localhost",
                    "TASKFLOW_BACKUP_EXPECTED_USER": "taskflow_migrator",
                    "TASKFLOW_BACKUP_EXPECTED_DATABASE": "postgres",
                    "TASKFLOW_BACKUP_OUTPUT_DIR": str(output_dir),
                    "RUNNER_TEMP": temp,
                    "CANDIDATE_VERSION": "0.9.0-alpha.9.179",
                    "CANDIDATE_BUILD": "20261024-1959",
                    "GITHUB_SHA": subprocess.run(
                        ["git", "rev-parse", "HEAD"], cwd=REPO,
                        check=True, capture_output=True, text=True,
                    ).stdout.strip(),
                })
                result = subprocess.run(
                    ["bash", str(RUNNER)], cwd=REPO, env=runner_env,
                    text=True, capture_output=True, timeout=900,
                )
                combined = result.stdout + result.stderr
                self.assertEqual(result.returncode, 0, "backup runner failed: " + combined)
                self.assertIn("TASKFLOW_BACKUP_ONLY_READY", result.stdout)
                self.assertNotIn("backup-ci-migrator", combined)
                self.assertNotIn("backup-ci-bootstrap", combined)

                files = sorted(path.name for path in output_dir.iterdir())
                self.assertEqual(len(files), 3)
                cipher = next(output_dir.glob("*.dump.age"))
                checksum = Path(str(cipher) + ".sha256")
                manifest_path = output_dir / "manifest.json"
                self.assertTrue(cipher.stat().st_mode & 0o077 == 0)
                self.assertEqual(hashlib.sha256(cipher.read_bytes()).hexdigest(),
                                 checksum.read_text().split()[0])
                manifest = json.loads(manifest_path.read_text())
                self.assertEqual(manifest["scope"],
                                 "taskflow schema only; not a full Supabase project/database backup")
                self.assertEqual(manifest["isolated_postgres_17_restore"], "PASS")
                self.assertEqual(manifest["table_row_counts_match"], "PASS")
                self.assertEqual(manifest["normalized_taskflow_schema_dump_match"], "PASS")
                self.assertNotIn("password", json.dumps(manifest).lower())
                self.assertNotIn("AGE-SECRET-KEY-", json.dumps(manifest))

                decrypted = temp_path / "decrypted.dump"
                subprocess.run([
                    "age", "--decrypt", "--identity", str(identity),
                    "--output", str(decrypted), str(cipher),
                ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
                listing = subprocess.run(
                    ["pg_restore", "--list", str(decrypted)],
                    check=True, capture_output=True, text=True,
                ).stdout
                self.assertRegex(listing, r"SCHEMA - taskflow(?:\s|$)")
                source_rows = subprocess.run(
                    ["docker", "exec", "-e", "PGPASSWORD=backup-ci-bootstrap",
                     container, "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres",
                     "-c", "SELECT count(*) FROM taskflow.issue"],
                    check=True, capture_output=True, text=True,
                ).stdout.strip()
                self.assertEqual(source_rows, "2", "BACKUP ONLY must not mutate source data")
                self.assertFalse((output_dir / "taskflow-schema.dump").exists())
            finally:
                subprocess.run(["docker", "rm", "-f", container],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == "__main__":
    unittest.main()

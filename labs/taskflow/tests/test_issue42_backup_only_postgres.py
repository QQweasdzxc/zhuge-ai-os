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
import urllib.parse
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).parents[1]
REPO = ROOT.parents[1]
RUNNER = ROOT / "overrides/issue42-backup-only.sh"


def command_exists(name):
    return shutil.which(name) is not None


class DriveApiMock:
    """Loopback-only Drive API fixture; it never contacts Google or stores PII."""
    folder_id = "1426lDVU97bSseRVzMLRMzh1C2eAIZ-xU"
    service_account = "backup-upload@unit-test.iam.gserviceaccount.com"

    def __init__(self):
        self.files = {}
        self.sessions = {}
        self.writable = True
        self.actor = self.service_account
        self.shared_drive = True
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                return

            def _send(self, status, payload=b"", headers=None):
                self.send_response(status)
                for key, value in (headers or {}).items():
                    self.send_header(key, value)
                if isinstance(payload, dict):
                    payload = json.dumps(payload).encode()
                    self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                if payload:
                    self.wfile.write(payload)

            def _authorized(self):
                return self.headers.get("Authorization") == "Bearer synthetic-drive-token"

            def do_GET(self):
                if not self._authorized():
                    return self._send(401)
                parsed = urllib.parse.urlsplit(self.path)
                query = urllib.parse.parse_qs(parsed.query)
                prefix = "/drive/v3/files/"
                if parsed.path == "/drive/v3/about":
                    return self._send(200, {"user": {"emailAddress": owner.actor}})
                if parsed.path == "/drive/v3/files":
                    entries = []
                    for file_id, item in owner.files.items():
                        requested = query.get("q", [""])[0]
                        if "name = '" in requested:
                            wanted = requested.split("name = '", 1)[1].split("'", 1)[0]
                            if item["name"] != wanted:
                                continue
                        entries.append(owner._metadata(file_id, item))
                    return self._send(200, {"files": entries})
                if not parsed.path.startswith(prefix):
                    return self._send(404)
                file_id = parsed.path[len(prefix):]
                if file_id == owner.folder_id:
                    permissions = []
                    if owner.writable:
                        permissions.append({"type": "user", "role": "writer",
                                           "emailAddress": owner.service_account})
                    else:
                        permissions.append({"type": "anyone", "role": "reader"})
                    if not owner.shared_drive:
                        permissions = [
                            {"type": "user", "role": "owner", "emailAddress": "pm@example.com"},
                        ]
                    folder = {
                        "id": owner.folder_id,
                        "mimeType": "application/vnd.google-apps.folder",
                        "capabilities": {"canAddChildren": owner.writable},
                        "permissions": permissions,
                    }
                    if owner.shared_drive:
                        folder["driveId"] = "synthetic-shared-drive"
                    return self._send(200, folder)
                item = owner.files.get(file_id)
                if item is None:
                    return self._send(404)
                if query.get("alt") == ["media"]:
                    return self._send(200, item["content"])
                return self._send(200, owner._metadata(file_id, item))

            def do_POST(self):
                if not self._authorized():
                    return self._send(401)
                parsed = urllib.parse.urlsplit(self.path)
                if parsed.path != "/upload/drive/v3/files":
                    return self._send(404)
                metadata = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
                session_id = uuid.uuid4().hex
                owner.sessions[session_id] = {"metadata": metadata, "content": bytearray()}
                location = f"{owner.base_url}/upload/drive/v3/session/{session_id}"
                return self._send(200, headers={"Location": location})

            def do_PUT(self):
                if not self._authorized():
                    return self._send(401)
                parsed = urllib.parse.urlsplit(self.path)
                prefix = "/upload/drive/v3/session/"
                if not parsed.path.startswith(prefix):
                    return self._send(404)
                session = owner.sessions.get(parsed.path[len(prefix):])
                if session is None:
                    return self._send(404)
                block = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                session["content"].extend(block)
                content_range = self.headers.get("Content-Range", "")
                total = int(content_range.rsplit("/", 1)[1])
                if len(session["content"]) < total:
                    return self._send(308, headers={"Range": f"bytes=0-{len(session['content']) - 1}"})
                metadata = session["metadata"]
                file_id = uuid.uuid4().hex
                owner.files[file_id] = {
                    "name": metadata["name"],
                    "mimeType": metadata["mimeType"],
                    "parents": metadata["parents"],
                    "content": bytes(session["content"]),
                }
                owner.sessions.pop(parsed.path[len(prefix):], None)
                return self._send(200, owner._metadata(file_id, owner.files[file_id]))

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"
        self.thread = None

    @staticmethod
    def _metadata(file_id, item):
        return {
            "id": file_id,
            "name": item["name"],
            "size": str(len(item["content"])),
            "mimeType": item["mimeType"],
            "parents": item["parents"],
            "md5Checksum": hashlib.md5(item["content"]).hexdigest(),
        }

    def __enter__(self):
        import threading
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, *_args):
        self.server.shutdown()
        self.server.server_close()
        if self.thread:
            self.thread.join(timeout=2)


class DriveUploaderContractTest(unittest.TestCase):
    def _fixture(self, temp_path):
        source_sha = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=REPO,
            check=True, capture_output=True, text=True,
        ).stdout.strip()
        version = json.loads((REPO / "version.json").read_text(encoding="utf-8"))
        run_id = "123456789"
        attempt = "1"
        stem = f"taskflow-schema-{source_sha}-run{run_id}-attempt{attempt}"
        dump_name = stem + ".dump"
        dump = temp_path / dump_name
        dump.write_bytes(b"synthetic TaskFlow backup fixture\n")
        dump.chmod(0o600)
        digest = hashlib.sha256(dump.read_bytes()).hexdigest()
        checksum = temp_path / (dump_name + ".sha256")
        checksum.write_text(f"{digest}  {dump_name}\n", encoding="utf-8")
        checksum.chmod(0o600)
        manifest_path = temp_path / (stem + ".manifest.json")
        manifest = {
            "format": "zhuge-taskflow-schema-backup-v2",
            "scope": "taskflow schema only; not a full Supabase project/database backup",
            "project_id": "lenpbbhwxyyfwgvjcozf",
            "candidate_version": version["version"],
            "candidate_build": version["build"],
            "source_sha": source_sha,
            "workflow_run_id": run_id,
            "workflow_run_attempt": attempt,
            "created_at_utc": "2026-10-24T00:00:00Z",
            "source_identity_verified": True,
            "tls_verify_full": True,
            "isolated_postgres_17_restore": "PASS",
            "table_row_counts_match": "PASS",
            "normalized_taskflow_schema_dump_match": "PASS",
            "application_layer_encryption": "none; PM-approved",
            "backup_file": dump_name,
            "backup_bytes": len(dump.read_bytes()),
            "backup_sha256": digest,
        }
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        manifest_path.chmod(0o600)
        environment = {
            "TASKFLOW_BACKUP_DRIVE_TEST_MODE": "1",
            "TASKFLOW_BACKUP_DRIVE_ACCESS_TOKEN": "synthetic-drive-token",
            "TASKFLOW_BACKUP_DRIVE_SERVICE_ACCOUNT": DriveApiMock.service_account,
            "TASKFLOW_BACKUP_DRIVE_API_BASE": "",
            "RUNNER_TEMP": str(temp_path),
            "GITHUB_SHA": source_sha,
            "GITHUB_RUN_ID": run_id,
            "GITHUB_RUN_ATTEMPT": attempt,
            "CANDIDATE_VERSION": version["version"],
            "CANDIDATE_BUILD": version["build"],
        }
        return source_sha, dump, checksum, manifest_path, environment

    def test_drive_upload_readback_and_candidate_gate(self):
        uploader = REPO / "labs/taskflow/overrides/issue42-backup-drive-upload.py"
        with tempfile.TemporaryDirectory(prefix="taskflow-drive-contract-") as temp:
            temp_path = Path(temp)
            with DriveApiMock() as drive:
                source_sha, dump, checksum, manifest, environment = self._fixture(temp_path)
                environment["TASKFLOW_BACKUP_DRIVE_API_BASE"] = drive.base_url + "/drive/v3"
                with patch.dict(os.environ, environment):
                    uploaded = subprocess.run(
                        ["python3", str(uploader), "--upload", str(dump), str(checksum), str(manifest)],
                        cwd=REPO, capture_output=True, text=True, check=False,
                    )
                    self.assertEqual(uploaded.returncode, 0, uploaded.stderr)
                    self.assertIn("TASKFLOW_BACKUP_DRIVE_READBACK_PASS", uploaded.stdout)
                    self.assertEqual(len(drive.files), 3)

                    preflight = subprocess.run(
                        ["python3", str(uploader), "--verify-candidate-backup"],
                        cwd=REPO, capture_output=True, text=True, check=False,
                    )
                    self.assertEqual(preflight.returncode, 0, preflight.stderr)
                    self.assertIn("TASKFLOW_DRIVE_BACKUP_PRECONDITION_PASS", preflight.stdout)
                    self.assertEqual(source_sha, json.loads(drive.files[next(
                        key for key, item in drive.files.items() if item["name"].endswith(".manifest.json")
                    )]["content"])["source_sha"])

    def test_drive_permission_and_actor_mismatch_fail_closed(self):
        uploader = REPO / "labs/taskflow/overrides/issue42-backup-drive-upload.py"
        with tempfile.TemporaryDirectory(prefix="taskflow-drive-acl-") as temp:
            with DriveApiMock() as drive:
                _, _, _, _, environment = self._fixture(Path(temp))
                environment["TASKFLOW_BACKUP_DRIVE_API_BASE"] = drive.base_url + "/drive/v3"
                with patch.dict(os.environ, environment):
                    drive.writable = False
                    denied = subprocess.run(
                        ["python3", str(uploader), "--check-target-only"],
                        cwd=REPO, capture_output=True, text=True, check=False,
                    )
                    self.assertNotEqual(denied.returncode, 0)
                    self.assertIn("drive_folder_not_writable", denied.stderr)
                    self.assertEqual(drive.files, {})

                    drive.writable = True
                    drive.actor = "unexpected@example.com"
                    wrong_actor = subprocess.run(
                        ["python3", str(uploader), "--check-target-only"],
                        cwd=REPO, capture_output=True, text=True, check=False,
                    )
                    self.assertNotEqual(wrong_actor.returncode, 0)
                    self.assertIn("drive_authenticated_principal_mismatch", wrong_actor.stderr)
                    self.assertEqual(drive.files, {})

    def test_my_drive_folder_is_rejected_before_any_database_access(self):
        uploader = REPO / "labs/taskflow/overrides/issue42-backup-drive-upload.py"
        with tempfile.TemporaryDirectory(prefix="taskflow-drive-my-drive-") as temp:
            with DriveApiMock() as drive:
                _, _, _, _, environment = self._fixture(Path(temp))
                environment["TASKFLOW_BACKUP_DRIVE_API_BASE"] = drive.base_url + "/drive/v3"
                drive.shared_drive = False
                with patch.dict(os.environ, environment):
                    rejected = subprocess.run(
                        ["python3", str(uploader), "--check-target-only"],
                        cwd=REPO, capture_output=True, text=True, check=False,
                    )
                    self.assertNotEqual(rejected.returncode, 0)
                    self.assertIn("service_account_requires_shared_drive", rejected.stderr)
                    self.assertEqual(drive.files, {})

    def test_changed_drive_backup_fails_install_precondition(self):
        uploader = REPO / "labs/taskflow/overrides/issue42-backup-drive-upload.py"
        with tempfile.TemporaryDirectory(prefix="taskflow-drive-integrity-") as temp:
            with DriveApiMock() as drive:
                _, dump, checksum, manifest, environment = self._fixture(Path(temp))
                environment["TASKFLOW_BACKUP_DRIVE_API_BASE"] = drive.base_url + "/drive/v3"
                with patch.dict(os.environ, environment):
                    uploaded = subprocess.run(
                        ["python3", str(uploader), "--upload", str(dump), str(checksum), str(manifest)],
                        cwd=REPO, capture_output=True, text=True, check=False,
                    )
                    self.assertEqual(uploaded.returncode, 0, uploaded.stderr)
                    item = next(item for item in drive.files.values() if item["name"].endswith(".dump"))
                    item["content"] = b"tampered backup fixture\n"
                    rejected = subprocess.run(
                        ["python3", str(uploader), "--verify-candidate-backup"],
                        cwd=REPO, capture_output=True, text=True, check=False,
                    )
                    self.assertNotEqual(rejected.returncode, 0)
                    self.assertIn("matching_drive_backup_failed_integrity_gate", rejected.stderr)


class BackupRunnerPostgres17Test(unittest.TestCase):
    def test_runner_restores_and_uploads_only_taskflow_schema(self):
        required = ("docker", "openssl", "pg_dump", "pg_restore", "psql", "createdb", "python3")
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
            # The postgres container runs as its postgres user and must be able
            # to traverse the bind mount directory to read the private key.
            tls.mkdir(mode=0o755)
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
                if not ready:
                    logs = subprocess.run(
                        ["docker", "logs", container], capture_output=True, text=True,
                        check=False,
                    ).stdout[-2000:]
                    self.fail("isolated PostgreSQL 17 did not become ready; container diagnostics: " + logs)

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
                source_sha = subprocess.run(
                    ["git", "rev-parse", "HEAD"], cwd=REPO,
                    check=True, capture_output=True, text=True,
                ).stdout.strip()
                with DriveApiMock() as drive:
                    runner_env = os.environ.copy()
                    runner_env.update({
                        "TASKFLOW_MIGRATION_PG_SERVICE": "taskflow_migrator",
                        "TASKFLOW_MIGRATION_PGSERVICEFILE_CONTENT": source_service,
                        "TASKFLOW_BACKUP_RESTORE_PG_SERVICE": "taskflow_restore",
                        "TASKFLOW_BACKUP_RESTORE_PGSERVICEFILE_CONTENT": restore_service,
                        "TASKFLOW_BACKUP_DRIVE_TEST_MODE": "1",
                        "TASKFLOW_BACKUP_DRIVE_ACCESS_TOKEN": "synthetic-drive-token",
                        "TASKFLOW_BACKUP_DRIVE_SERVICE_ACCOUNT": DriveApiMock.service_account,
                        "TASKFLOW_BACKUP_DRIVE_API_BASE": drive.base_url + "/drive/v3",
                        "TASKFLOW_BACKUP_EXPECTED_HOST": "localhost",
                        "TASKFLOW_BACKUP_EXPECTED_USER": "taskflow_migrator",
                        "TASKFLOW_BACKUP_EXPECTED_DATABASE": "postgres",
                        "TASKFLOW_BACKUP_OUTPUT_DIR": str(output_dir),
                        "RUNNER_TEMP": temp,
                        "CANDIDATE_VERSION": json.loads(
                            (REPO / "version.json").read_text(encoding="utf-8")
                        )["version"],
                        "CANDIDATE_BUILD": json.loads(
                            (REPO / "version.json").read_text(encoding="utf-8")
                        )["build"],
                        "GITHUB_SHA": source_sha,
                        "GITHUB_RUN_ID": "123456789",
                        "GITHUB_RUN_ATTEMPT": "1",
                    })
                    result = subprocess.run(
                        ["bash", str(RUNNER)], cwd=REPO, env=runner_env,
                        text=True, capture_output=True, timeout=900,
                    )
                    combined = result.stdout + result.stderr
                    self.assertEqual(result.returncode, 0, "backup runner failed: " + combined)
                    self.assertIn("TASKFLOW_BACKUP_ONLY_READY", result.stdout)
                    self.assertIn("TASKFLOW_BACKUP_DRIVE_READBACK_PASS", result.stdout)
                    self.assertNotIn("backup-ci-migrator", combined)
                    self.assertNotIn("backup-ci-bootstrap", combined)
                    self.assertFalse(output_dir.exists(), "ephemeral plaintext directory must be removed")

                    remote = {item["name"]: item["content"] for item in drive.files.values()}
                    self.assertEqual(len(remote), 3)
                    manifest_name = next(name for name in remote if name.endswith(".manifest.json"))
                    manifest = json.loads(remote[manifest_name])
                    self.assertEqual(manifest["scope"],
                                     "taskflow schema only; not a full Supabase project/database backup")
                    self.assertEqual(manifest["isolated_postgres_17_restore"], "PASS")
                    self.assertEqual(manifest["table_row_counts_match"], "PASS")
                    self.assertEqual(manifest["normalized_taskflow_schema_dump_match"], "PASS")
                    self.assertEqual(manifest["application_layer_encryption"], "none; PM-approved")
                    self.assertEqual(manifest["source_sha"], source_sha)
                    self.assertNotIn("password", json.dumps(manifest).lower())

                    dump_name = manifest["backup_file"]
                    dump_bytes = remote[dump_name]
                    digest = hashlib.sha256(dump_bytes).hexdigest()
                    self.assertEqual(digest, manifest["backup_sha256"])
                    self.assertEqual(len(dump_bytes), manifest["backup_bytes"])
                    self.assertEqual(remote[dump_name + ".sha256"].decode().strip(),
                                     f"{digest}  {dump_name}")
                    restored_dump = temp_path / "readback.dump"
                    restored_dump.write_bytes(dump_bytes)
                    restored_dump.chmod(0o600)
                    listing = subprocess.run(
                        ["pg_restore", "--list", str(restored_dump)],
                        check=True, capture_output=True, text=True,
                    ).stdout
                    self.assertRegex(listing, r"SCHEMA - taskflow(?:\s|$)")

                    backup_gate = subprocess.run(
                        ["python3", str(REPO / "labs/taskflow/overrides/issue42-backup-drive-upload.py"),
                         "--verify-candidate-backup"], cwd=REPO, env=runner_env,
                        text=True, capture_output=True,
                    )
                    self.assertEqual(backup_gate.returncode, 0, backup_gate.stderr)
                    self.assertIn("TASKFLOW_DRIVE_BACKUP_PRECONDITION_PASS", backup_gate.stdout)

                    drive.writable = False
                    denied = subprocess.run(
                        ["python3", str(REPO / "labs/taskflow/overrides/issue42-backup-drive-upload.py"),
                         "--check-target-only"], cwd=REPO, env=runner_env,
                        text=True, capture_output=True,
                    )
                    self.assertNotEqual(denied.returncode, 0)
                    self.assertIn("drive_folder_not_writable", denied.stderr)

                    fake_bin = temp_path / "fake-bin"
                    fake_bin.mkdir()
                    psql_marker = temp_path / "psql-was-called"
                    fake_psql = fake_bin / "psql"
                    fake_psql.write_text(f"#!/bin/sh\nprintf called > '{psql_marker}'\nexit 99\n")
                    fake_psql.chmod(0o700)
                    blocked_env = runner_env.copy()
                    blocked_env["PATH"] = str(fake_bin) + os.pathsep + blocked_env["PATH"]
                    blocked_env["TASKFLOW_BACKUP_OUTPUT_DIR"] = str(temp_path / "blocked-output")
                    blocked = subprocess.run(
                        ["bash", str(RUNNER)], cwd=REPO, env=blocked_env,
                        text=True, capture_output=True, timeout=60,
                    )
                    self.assertNotEqual(blocked.returncode, 0)
                    self.assertIn("TASKFLOW_BACKUP_FAILED stage=drive_target_preflight", blocked.stderr)
                    self.assertFalse(psql_marker.exists(), "Drive failure must happen before production DB reads")
                    self.assertFalse((temp_path / "blocked-output").exists())

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

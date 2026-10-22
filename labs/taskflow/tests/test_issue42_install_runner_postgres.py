"""Negative execution tests for the one-shot runner.

These invoke the real shell runner against a disposable PostgreSQL service. No
candidate SQL is expected to commit: the test intentionally supplies the wrong
role and verifies fail-closed before installation.
"""
import os, shutil, subprocess, tempfile, uuid, socket
from pathlib import Path

ROOT = Path(__file__).parents[1]
RUNNER = ROOT / "overrides/issue42-install-once.sh"

def test_runner_rejects_non_migrator_without_exposing_dsn():
    if shutil.which("docker") is None or shutil.which("psql") is None:
        return
    name = "tf-42-runner-" + uuid.uuid4().hex[:8]
    port = 55432 + (os.getpid() % 1000)
    try:
        subprocess.run(["docker", "run", "--rm", "-d", "--name", name,
                        "-e", "POSTGRES_PASSWORD=test", "-p", f"127.0.0.1:{port}:5432", "postgres:16"], check=True,
                       stdout=subprocess.DEVNULL)
        for _ in range(30):
            if subprocess.run(["docker", "exec", name, "pg_isready", "-U", "postgres"],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
                break
        with tempfile.TemporaryDirectory() as d:
            service = Path(d) / "pg_service.conf"
            service.write_text(f"[wrong_role]\nhost=127.0.0.1\nport={port}\ndbname=postgres\nuser=postgres\n")
            env = os.environ.copy()
            env.update({"HOME": d, "PGSERVICEFILE": str(service),
                        "TASKFLOW_MIGRATION_PG_SERVICE": "wrong_role"})
            result = subprocess.run(["sh", str(RUNNER)], cwd=ROOT.parents[1], env=env,
                                    text=True, capture_output=True)
            assert result.returncode != 0
            assert "migrator identity mismatch" in (result.stdout + result.stderr)
            assert "postgres://" not in (result.stdout + result.stderr)
    finally:
        subprocess.run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL)

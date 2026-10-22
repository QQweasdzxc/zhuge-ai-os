from pathlib import Path

ROOT = Path(__file__).parents[1]
RUNNER = (ROOT / "overrides/issue42-install-once.sh").read_text()

def test_runner_is_sha_locked_and_install_only():
    assert "50b716e38fe2703607fe19880f60c298c7af1bac" in RUNNER
    assert "exec /app/migrate" not in RUNNER
    assert "issue42_connector_create_issue_candidate.sql" in RUNNER
    assert "no card creation performed" in RUNNER

def test_runner_checks_migrator_identity_and_schema_boundary():
    assert "session_user <> 'taskflow_migrator'" in RUNNER
    assert "current_user <> 'taskflow_migrator'" in RUNNER
    assert "current_schemas(false)" in RUNNER
    assert "INSTALL BLOCKED" in RUNNER

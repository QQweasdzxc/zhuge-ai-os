import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const workflow = await readFile(new URL("../.github/workflows/taskflow-official-release-gate.yml", import.meta.url), "utf8");
const runner = await readFile(new URL("../labs/taskflow/overrides/issue42-install-once.sh", import.meta.url), "utf8");
const backupRunner = await readFile(new URL("../labs/taskflow/overrides/issue42-backup-only.sh", import.meta.url), "utf8");
const installJob = workflow.split("  issue42-install-only:")[1]?.split("\n  issue42-backup-only:")[0] || "";
const backupJob = workflow.split("  issue42-backup-only:")[1]?.split("\n  source-identity:")[0] || "";

test("Issue #42 production install is explicit manual-only and bound to the review candidate", () => {
  assert.match(workflow, /issue42_install_only:[\s\S]*type: boolean[\s\S]*default: false/);
  assert.match(workflow, /expected_candidate_sha:[\s\S]*type: string/);
  assert.match(workflow, /inputs\.issue42_install_only == true \|\| inputs\.issue42_backup_only == true/);
  assert.match(workflow, /inputs\.issue42_install_only != inputs\.issue42_backup_only/);
  assert.match(installJob, /inputs\.issue42_install_only == true && inputs\.issue42_backup_only != true/);
  assert.match(backupJob, /inputs\.issue42_backup_only == true && inputs\.issue42_install_only != true/);
  assert.match(workflow, /refs\/heads\/review\/p0-functional-consolidation-20261023/);
  assert.match(workflow, /test "\$GITHUB_SHA" = "\$EXPECTED_CANDIDATE_SHA"/);
  assert.match(workflow, /git merge-base --is-ancestor origin\/main/);
});

test("Issue #42 Production job requires a protected environment and live migrator identity", () => {
  assert.match(workflow, /production-migration-environments\.json/);
  assert.match(workflow, /rule\.type === 'required_reviewers'/);
  assert.match(workflow, /environment:\s*\n\s+name: production-migration/);
  assert.match(workflow, /TASKFLOW_MIGRATION_PG_SERVICE: \$\{\{ secrets\.TASKFLOW_MIGRATION_PG_SERVICE \}\}/);
  assert.match(workflow, /TASKFLOW_MIGRATION_PGSERVICEFILE_CONTENT: \$\{\{ secrets\.TASKFLOW_MIGRATION_PGSERVICEFILE_CONTENT \}\}/);
  assert.match(workflow, /chmod 600 "\$service_file"/);
  assert.match(workflow, /identity="\$\(PGSERVICEFILE="\$service_file" PGSERVICE="\$service" psql/);
  assert.match(workflow, /taskflow_migrator\|taskflow_migrator\|postgres/);
  assert.match(workflow, /db\.lenpbbhwxyyfwgvjcozf\.supabase\.co/);
  assert.match(workflow, /sslmode': 'verify-full'/);
  assert.match(workflow, /taskflow-build-parity\.yml\/runs\?head_sha=\$EXPECTED_CANDIDATE_SHA/);
  assert.match(workflow, /run\.head_sha === expectedSha[\s\S]*run\.conclusion === 'success'/);
  assert.match(installJob, /needs: \[issue42-install-preflight, source-identity, browser, fullsource\]/);
  assert.match(installJob, /git fetch --no-tags origin 50b716e38fe2703607fe19880f60c298c7af1bac/);
});

test("Production install uses only the reviewed runner and SQL pin; it cannot create a Canary", () => {
  assert.match(workflow, /sh labs\/taskflow\/overrides\/issue42-install-once\.sh/);
  assert.match(workflow, /expected_candidate_sha/);
  assert.match(workflow, /ISSUE42_INSTALL_ONLY_READY/);
  assert.match(workflow, /ISSUE42_ALREADY_INSTALLED/);
  assert.match(runner, /EXPECTED_SHA=50b716e38fe2703607fe19880f60c298c7af1bac/);
  assert.match(runner, /EXPECTED_FILE_SHA=b2a8fa1f986efab3e27997fd02b04613fef3d31aea68665f77192ba8a227b6cc/);
  assert.doesNotMatch(runner, /\/app\/migrate up/);
  assert.ok(installJob, "the isolated install job must exist");
  assert.doesNotMatch(installJob, /taskflow-migrate\.sh|\/app\/migrate up|pg_restore|DROP TABLE|DELETE FROM taskflow\.issue/i);
  assert.match(workflow, /No Canary card was created by this job\./);
});

test("service configuration is never printed or passed as a DSN argument", () => {
  assert.match(workflow, /printf '%s' "\$TASKFLOW_MIGRATION_PGSERVICEFILE_CONTENT" > "\$service_file"/);
  assert.doesNotMatch(workflow, /echo\s+.*TASKFLOW_MIGRATION_PGSERVICEFILE_CONTENT|printenv|set -x/);
  assert.doesNotMatch(workflow, /psql\s+"\$TASKFLOW_MIGRATION_DATABASE_URL"/);
  assert.match(workflow, /invalid TaskFlow migration service name/);
});

test("BACKUP ONLY is manual, exact-candidate, protected, schema-scoped, and cannot install SQL", () => {
  assert.match(workflow, /issue42_backup_only:[\s\S]*type: boolean[\s\S]*default: false/);
  assert.match(workflow, /backup_age_recipient:[\s\S]*public recipient only; never enter a private key/);
  assert.match(backupJob, /github\.event_name == 'workflow_dispatch'/);
  assert.match(backupJob, /needs: \[issue42-install-preflight, source-identity, browser, fullsource\]/);
  assert.match(backupJob, /name: production-migration/);
  assert.match(backupJob, /TASKFLOW_MIGRATION_PG_SERVICE: \$\{\{ secrets\.TASKFLOW_MIGRATION_PG_SERVICE \}\}/);
  assert.match(backupJob, /TASKFLOW_MIGRATION_PGSERVICEFILE_CONTENT: \$\{\{ secrets\.TASKFLOW_MIGRATION_PGSERVICEFILE_CONTENT \}\}/);
  assert.match(backupJob, /TASKFLOW_BACKUP_AGE_RECIPIENT: \$\{\{ inputs\.backup_age_recipient \}\}/);
  assert.match(backupJob, /TASKFLOW_BACKUP_EXPECTED_HOST: db\.lenpbbhwxyyfwgvjcozf\.supabase\.co/);
  assert.match(backupJob, /postgresql-client-17 age/);
  assert.match(backupJob, /TASKFLOW_BACKUP_RESTORE_PGSERVICEFILE_CONTENT:/);
  assert.match(backupRunner, /--schema=taskflow --file=\"\$DUMP\"/);
  assert.match(backupRunner, /age --encrypt --recipient/);
  assert.match(backupRunner, /restore_server_not_postgresql_17/);
  assert.match(backupRunner, /test \"\$\(git rev-parse HEAD 2>\/dev\/null\)\" = \"\$GITHUB_SHA\"/);
  assert.match(backupJob, /run: bash labs\/taskflow\/overrides\/issue42-backup-only\.sh/);
  assert.match(backupJob, /B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8/);
  assert.match(backupJob, /retention-days: 1/);
  assert.match(backupJob, /\*\.dump\.age/);
  assert.match(backupJob, /\*\.dump\.age\.sha256/);
  assert.match(backupJob, /manifest\.json/);
  assert.doesNotMatch(backupJob, /issue42-install-once\.sh|TASKFLOW_BACKUP_AGE_IDENTITY|AGE-SECRET-KEY/);
  assert.match(workflow, /No Canary card was created by this job\./);
});

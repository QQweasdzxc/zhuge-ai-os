#!/usr/bin/env bash
set -euo pipefail

: "${TASKFLOW_STORAGE_TEST_DATABASE_URL:?isolated PostgreSQL test URL is required}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

psql_as() {
  local role="$1" password="$2"
  shift 2
  PGPASSWORD="$password" psql -h localhost -p 5432 -U "$role" -d postgres -v ON_ERROR_STOP=1 "$@"
}

admin() { psql_as postgres taskflow-ci-postgres "$@"; }
restricted() {
  local role="$1" password="$2"
  shift 2
  psql_as "$role" "$password" "$@"
}

admin -f "$root/labs/taskflow/tests/taskflow_supabase_storage_ci_fixture.sql" >/dev/null

# The bootstrap uses a direct, non-superuser database-CREATE login with no
# managed-schema privileges. Production uses its existing postgres login,
# which has the same relevant capability boundary.
restricted taskflow_bootstrap taskflow-ci-bootstrap \
  -f "$root/labs/taskflow/sql/taskflow_supabase_storage_schema_bootstrap.sql" >/dev/null

# Prove the reviewed migration SQL cannot be run as postgres or via SET ROLE.
if admin -f "$root/labs/taskflow/sql/taskflow_supabase_storage_candidate.sql" >/tmp/taskflow-storage-wrong-role.log 2>&1; then
  echo "TaskFlow Storage helper SQL unexpectedly ran as postgres" >&2
  exit 1
fi
grep -F "connect directly as taskflow_migrator" /tmp/taskflow-storage-wrong-role.log >/dev/null
if admin -c "SET ROLE taskflow_migrator" -f "$root/labs/taskflow/sql/taskflow_supabase_storage_candidate.sql" >/tmp/taskflow-storage-set-role.log 2>&1; then
  echo "TaskFlow Storage helper SQL unexpectedly accepted SET ROLE" >&2
  exit 1
fi
grep -F "connect directly as taskflow_migrator" /tmp/taskflow-storage-set-role.log >/dev/null

identity="$(restricted taskflow_migrator taskflow-ci-migrator -qAt -c "SELECT session_user || '|' || current_user")"
[[ "$identity" == "taskflow_migrator|taskflow_migrator" ]] || {
  echo "Unexpected isolated helper install identity" >&2
  exit 1
}
restricted taskflow_migrator taskflow-ci-migrator \
  -f "$root/labs/taskflow/sql/taskflow_supabase_storage_candidate.sql" >/dev/null

# The CI database administrator represents the Supabase Dashboard's managed
# Storage policy operation. It is not an application connection. Production
# must create the bucket/policies through the Dashboard, not this CI identity.
admin \
  -f "$root/labs/taskflow/tests/taskflow_supabase_storage_ci_policies.sql" >/dev/null
admin -f "$root/labs/taskflow/tests/taskflow_supabase_storage_ci_assertions.sql" >/dev/null
restricted taskflow_bootstrap taskflow-ci-bootstrap \
  -f "$root/labs/taskflow/sql/taskflow_supabase_storage_installation_verification.sql" >/dev/null

user_a=11111111-1111-4111-8111-111111111111
user_b=33333333-3333-4333-8333-333333333333
workspace=22222222-2222-4222-8222-222222222222

as_user() {
  local user_id="$1" sql="$2"
  restricted authenticated taskflow-ci-authenticated \
    -qAt -c "SET request.jwt.claim.sub = '$user_id'" -c "$sql"
}

as_claims() {
  local claims="$1" sql="$2"
  restricted authenticated taskflow-ci-authenticated \
    -qAt -c "SET request.jwt.claim.sub = ''" \
    -c "SET request.jwt.claims = '$claims'" \
    -c "$sql"
}

expect_denied() {
  local label="$1" sql="$2" output
  if output="$(as_user "$user_a" "$sql" 2>&1)"; then
    echo "Expected Storage RLS rejection did not occur: $label" >&2
    exit 1
  fi
  if [[ "$output" != *"row-level security policy"* ]]; then
    echo "Expected RLS rejection for $label; command failed for another reason: $output" >&2
    exit 1
  fi
}

[[ "$(as_user "$user_a" "SELECT session_user || '|' || current_user || '|' || auth.uid()::text")" == "authenticated|authenticated|$user_a" ]]
[[ "$(as_user "$user_a" "SELECT taskflow_storage.taskflow_storage_can_access_object('workspaces/$workspace/018f0000-0000-7000-8000-000000000001.pdf')")" == "t" ]]
[[ "$(as_claims "{\"sub\":\"$user_a\",\"role\":\"authenticated\"}" "SELECT taskflow_storage.taskflow_storage_can_access_object('workspaces/$workspace/018f0000-0000-7000-8000-000000000001.pdf')")" == "t" ]]
[[ "$(as_claims '{"sub":"not-a-uuid"}' "SELECT taskflow_storage.taskflow_storage_can_access_object('workspaces/$workspace/018f0000-0000-7000-8000-000000000001.pdf')")" == "f" ]]
[[ "$(as_claims 'invalid-json' "SELECT taskflow_storage.taskflow_storage_can_access_object('workspaces/$workspace/018f0000-0000-7000-8000-000000000001.pdf')")" == "f" ]]
[[ "$(as_claims '' "SELECT taskflow_storage.taskflow_storage_can_access_object('workspaces/$workspace/018f0000-0000-7000-8000-000000000001.pdf')")" == "f" ]]
[[ "$(as_user "$user_a" "SELECT taskflow_storage.taskflow_storage_can_access_object('workspaces/$workspace/not-a-uuid.pdf')")" == "f" ]]
[[ "$(as_user "$user_a" "SELECT taskflow_storage.taskflow_storage_can_access_object('users/$user_b/018f0000-0000-7000-8000-000000000003.png')")" == "f" ]]
[[ "$(as_user "$user_a" "SELECT taskflow_storage.taskflow_storage_can_access_object('workspaces/99999999-9999-4999-8999-999999999999/018f0000-0000-7000-8000-000000000001.pdf')")" == "f" ]]

as_user "$user_a" "INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES ('taskflow-attachments','workspaces/$workspace/018f0000-0000-7000-8000-000000000001.pdf','$user_a')" >/dev/null
as_user "$user_a" "INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES ('taskflow-attachments','users/$user_a/018f0000-0000-7000-8000-000000000002.png','$user_a')" >/dev/null
expect_denied "other user's path" "INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES ('taskflow-attachments','users/$user_b/018f0000-0000-7000-8000-000000000003.png','$user_a')"
expect_denied "spoofed Storage owner" "INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES ('taskflow-attachments','users/$user_a/018f0000-0000-7000-8000-000000000004.png','$user_b')"
expect_denied "invalid UUIDv7 key" "INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES ('taskflow-attachments','users/$user_a/not-a-uuid.pdf','$user_a')"
expect_denied "unrelated bucket" "INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES ('legacy-bucket','workspaces/$workspace/018f0000-0000-7000-8000-000000000005.pdf','$user_a')"

[[ "$(as_user "$user_a" "SELECT count(*) FROM storage.objects WHERE bucket_id='taskflow-attachments'")" == "2" ]]
updated_rows="$(as_user "$user_a" "UPDATE storage.objects SET name='changed' WHERE name='users/$user_a/018f0000-0000-7000-8000-000000000002.png' RETURNING name")"
[[ -z "$updated_rows" ]]
[[ "$(as_user "$user_a" "SELECT count(*) FROM storage.objects WHERE name='users/$user_a/018f0000-0000-7000-8000-000000000002.png'")" == "1" ]]

[[ "$(as_user "$user_b" "SELECT session_user || '|' || current_user || '|' || auth.uid()::text")" == "authenticated|authenticated|$user_b" ]]
as_user "$user_b" "INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES ('taskflow-attachments','workspaces/$workspace/018f0000-0000-7000-8000-000000000006.pdf','$user_b')" >/dev/null
[[ "$(as_user "$user_b" "SELECT count(*) FROM storage.objects WHERE bucket_id='taskflow-attachments'")" == "2" ]]
delete_rows="$(as_user "$user_b" "DELETE FROM storage.objects WHERE name='workspaces/$workspace/018f0000-0000-7000-8000-000000000001.pdf' RETURNING 1")"
[[ -z "$delete_rows" ]]
delete_rows="$(as_user "$user_a" "DELETE FROM storage.objects WHERE name='workspaces/$workspace/018f0000-0000-7000-8000-000000000006.pdf' RETURNING name")"
[[ "$delete_rows" == "workspaces/$workspace/018f0000-0000-7000-8000-000000000006.pdf" ]]

nonmember=44444444-4444-4444-8444-444444444444
[[ "$(as_user "$nonmember" "SELECT count(*) FROM storage.objects WHERE bucket_id='taskflow-attachments'")" == "0" ]]
anon_count="$(restricted anon taskflow-ci-anon -qAt -c "SET request.jwt.claim.sub = '$user_a'" -c "SELECT count(*) FROM storage.objects WHERE bucket_id='taskflow-attachments'")"
[[ "$anon_count" == "0" ]]

echo "TASKFLOW_STORAGE_RESTRICTED_INSTALL_IDENTITY=PASS"
echo "TASKFLOW_STORAGE_HELPERS_AND_ACL=PASS"
echo "TASKFLOW_STORAGE_PRIVATE_BUCKET_RLS=PASS"
echo "TASKFLOW_STORAGE_USER_WORKSPACE_ISOLATION=PASS"
echo "TASKFLOW_STORAGE_DENIALS_AND_NO_UPDATE_POLICY=PASS"
echo "TASKFLOW_STORAGE_LEGACY_BUCKET_UNCHANGED=PASS"

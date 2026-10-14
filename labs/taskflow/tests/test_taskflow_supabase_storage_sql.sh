#!/usr/bin/env bash
set -euo pipefail

: "${TASKFLOW_STORAGE_TEST_DATABASE_URL:?isolated PostgreSQL test URL is required}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
psql "$TASKFLOW_STORAGE_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$root/labs/taskflow/tests/taskflow_supabase_storage_ci_fixture.sql"
psql "$TASKFLOW_STORAGE_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$root/labs/taskflow/sql/taskflow_supabase_storage_candidate.sql"
psql "$TASKFLOW_STORAGE_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$root/labs/taskflow/tests/taskflow_supabase_storage_ci_assertions.sql"

user_a=11111111-1111-4111-8111-111111111111
user_b=33333333-3333-4333-8333-333333333333
workspace=22222222-2222-4222-8222-222222222222
export PGPASSWORD=taskflow-ci-only
export PGUSER=authenticated
export PGOPTIONS="-c request.jwt.claim.sub=$user_a"

psql -U authenticated "$TASKFLOW_STORAGE_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -c "INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES ('taskflow-attachments','workspaces/$workspace/018f0000-0000-7000-8000-000000000001.pdf','$user_a')"
psql -U authenticated "$TASKFLOW_STORAGE_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -c "INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES ('taskflow-attachments','users/$user_a/018f0000-0000-7000-8000-000000000002.png','$user_a')"

expect_denied() {
  local label="$1"
  local sql="$2"
  if psql -U authenticated "$TASKFLOW_STORAGE_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -c "$sql" >/dev/null 2>&1; then
    echo "Expected Storage RLS rejection did not occur: $label" >&2
    exit 1
  fi
}
expect_denied "user path for another identity" "INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES ('taskflow-attachments','users/$user_b/018f0000-0000-7000-8000-000000000003.png','$user_a')"
expect_denied "spoofed Storage owner" "INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES ('taskflow-attachments','users/$user_a/018f0000-0000-7000-8000-000000000004.png','$user_b')"
expect_denied "unrelated bucket" "INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES ('legacy-bucket','workspaces/$workspace/018f0000-0000-7000-8000-000000000005.pdf','$user_a')"

visible_a="$(psql -U authenticated "$TASKFLOW_STORAGE_TEST_DATABASE_URL" -At -c "SELECT count(*) FROM storage.objects WHERE bucket_id='taskflow-attachments'")"
[[ "$visible_a" == "2" ]]

export PGOPTIONS="-c request.jwt.claim.sub=$user_b"
psql -U authenticated "$TASKFLOW_STORAGE_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -c "INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES ('taskflow-attachments','workspaces/$workspace/018f0000-0000-7000-8000-000000000006.pdf','$user_b')"
visible_b="$(psql -U authenticated "$TASKFLOW_STORAGE_TEST_DATABASE_URL" -At -c "SELECT count(*) FROM storage.objects WHERE bucket_id='taskflow-attachments'")"
[[ "$visible_b" == "2" ]]
delete_rows="$(psql -U authenticated "$TASKFLOW_STORAGE_TEST_DATABASE_URL" -At -c "DELETE FROM storage.objects WHERE name='workspaces/$workspace/018f0000-0000-7000-8000-000000000001.pdf' RETURNING 1")"
[[ -z "$delete_rows" ]]

export PGOPTIONS="-c request.jwt.claim.sub=44444444-4444-4444-8444-444444444444"
visible_nonmember="$(psql -U authenticated "$TASKFLOW_STORAGE_TEST_DATABASE_URL" -At -c "SELECT count(*) FROM storage.objects WHERE bucket_id='taskflow-attachments'")"
[[ "$visible_nonmember" == "0" ]]

echo "TASKFLOW_STORAGE_RLS_WORKSPACE_USER_ISOLATION=PASS"
echo "TASKFLOW_STORAGE_RLS_UNAUTHORIZED_INSERT_DELETE=PASS"

#!/bin/sh
# Explicit one-shot release step, never enabled by default.
set -eu
[ "${TASKFLOW_DRIVE_INSTALL_METADATA:-0}" = 1 ] || exit 0
: "${TASKFLOW_MIGRATION_DATABASE_URL:?Private Drive install requires existing restricted migrator}"
SQL_FILE="${TASKFLOW_DRIVE_METADATA_FILE:-/app/taskflow-drive-metadata.sql}"
EXPECTED=2eccf8ae1a15f43aa21075bdb5fccfc5256fd1245e90d99cec1b3635fe423357
actual=$(sha256sum "$SQL_FILE" | cut -d' ' -f1)
[ "$actual" = "$EXPECTED" ] || { echo 'Drive metadata source hash mismatch' >&2;exit 1; }
marker="taskflow-private-drive-v1:$EXPECTED"
state=$(psql "$TASKFLOW_MIGRATION_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
 IF current_user<>'taskflow_migrator' THEN RAISE EXCEPTION 'Drive install requires restricted migrator';END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND(rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)) THEN RAISE EXCEPTION 'Elevated migration role refused';END IF;
END $$;
SELECT CASE WHEN to_regclass('taskflow.attachment_drive_object') IS NULL THEN 'absent' ELSE coalesce(obj_description(to_regclass('taskflow.attachment_drive_object'),'pg_class'),'unmarked') END;
SQL
)
state=$(printf '%s\n' "$state" | tail -1)
if [ "$state" = absent ]; then
  # Place receipt within the same already-qualified transaction.
  { sed '$d' "$SQL_FILE";printf "COMMENT ON TABLE taskflow.attachment_drive_object IS '%s';\nCOMMIT;\n" "$marker"; } | psql "$TASKFLOW_MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1
elif [ "$state" != "$marker" ]; then
  echo 'Drive metadata exists without exact release receipt; refusing changes' >&2;exit 1
fi
psql "$TASKFLOW_MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['attachment_drive_object','attachment_drive_setup_state','attachment_drive_grant','attachment_drive_folder','attachment_drive_delete_queue'] LOOP
 IF to_regclass('taskflow.'||t) IS NULL OR (SELECT relowner<>current_user::regrole OR NOT relrowsecurity FROM pg_class WHERE oid=to_regclass('taskflow.'||t)) OR has_table_privilege('anon','taskflow.'||t,'SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('authenticated','taskflow.'||t,'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Drive metadata receipt ACL mismatch';END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='taskflow.attachment'::regclass AND tgname='drive_attachment_delete' AND NOT tgisinternal) OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='taskflow.attachment'::regclass AND tgname='drive_attachment_reference' AND NOT tgisinternal) THEN RAISE EXCEPTION 'Drive native trigger missing';END IF;
END $$;
SQL
echo 'Private Drive metadata exact-source install verified; storage remains unchanged'

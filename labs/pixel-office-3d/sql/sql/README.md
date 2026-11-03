# Account-private roster SQL

Candidate migration: `../../../supabase/migrations/20261102024755_office_member_roster.sql`.
Run postflight after the separately authorized database deployment. Rollback is destructive; see its backup and client-revert prerequisites. Never commit private roster backups.

Frontend uses authenticated PostgREST and RLS. Source deployment alone does not apply SQL.

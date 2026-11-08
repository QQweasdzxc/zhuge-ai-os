-- MAIN ONLY, after reviewing the live aggregate impact and accepting the single unproven identity becoming Off.
-- This is not part of the migration and has NOT been executed against production.
-- It snapshots App-scoped identities and sets server-clock cutoff atomically;
-- callers cannot supply a time, target, list or backdate. EXECUTE is owner-only.
select private.activate_app_access_model(1);
-- Expected unproven count is an explicit main acknowledgement, not a list of users
-- or a caller-controlled timestamp. Any count drift aborts before writing.

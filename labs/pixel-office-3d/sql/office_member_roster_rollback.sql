-- DESTRUCTIVE: first export each owner's roster through an authorized private
-- backup workflow. Never put that backup in repo/public artifacts. Revert the
-- client before applying. Already migrated device copies cannot be recovered
-- from localStorage. This rollback requires separate production approval.
begin;
drop table if exists public.office_member_roster;
drop function if exists public.office_member_roster_touch();
commit;

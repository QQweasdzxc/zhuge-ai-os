-- DESTRUCTIVE: drops every owner's stored appearance preference. Revert the client
-- before applying, and export a private backup through an authorized workflow first.
-- Never put that backup in repo/public artifacts. Requires separate production approval.
begin;
alter table public.office_member_roster drop constraint if exists office_member_roster_prefs_object;
alter table public.office_member_roster drop column if exists prefs;
commit;

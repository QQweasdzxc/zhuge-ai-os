-- Account-private per-member appearance preference, stored on the existing roster row.
-- Values: name -> 'female' | 'male'. Absence means 'auto'. No new grants or policies:
-- the existing owner-only RLS on the row covers this column.
begin;
alter table public.office_member_roster
  add column prefs jsonb not null default '{}'::jsonb;
alter table public.office_member_roster
  add constraint office_member_roster_prefs_object check (jsonb_typeof(prefs) = 'object');
comment on column public.office_member_roster.prefs is 'member name -> appearance (female|male); absent = auto';
commit;

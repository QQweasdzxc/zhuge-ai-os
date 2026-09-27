-- Module C Workflow v2 draft lineage.
-- A new draft inherits the Board Instance's latest published version as its
-- explicit parent.  This is additive and does not rewrite existing versions
-- or cards.

begin;

create or replace function private.board_workflow_set_draft_lineage()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $function$
begin
  if new.status = 'draft' and new.based_on_workflow_version_id is null then
    select d.id
      into new.based_on_workflow_version_id
    from public.board_workflow_definitions d
    where d.board_instance_id = new.board_instance_id
      and d.status = 'published'
    order by d.version_no desc
    limit 1;
  end if;
  return new;
end;
$function$;

drop trigger if exists board_workflow_draft_lineage_before_insert
  on public.board_workflow_definitions;
create trigger board_workflow_draft_lineage_before_insert
  before insert on public.board_workflow_definitions
  for each row
  execute function private.board_workflow_set_draft_lineage();

revoke all on function private.board_workflow_set_draft_lineage() from public, anon, authenticated;

comment on function private.board_workflow_set_draft_lineage() is
  'Module C canonical draft lineage; links new drafts to the latest published version without rewriting cards or history.';

commit;

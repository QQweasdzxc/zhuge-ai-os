-- Module C canonical attachment metadata: display name + note.
-- Shared by every C consumer; storage object path/name remains unchanged.
begin;

alter table public.board_task_attachments
  add column if not exists display_name text,
  add column if not exists note text;

create or replace function public.board_update_task_attachment_metadata(
  p_attachment_id uuid,
  p_display_name text default null,
  p_note text default null
)
returns public.board_task_attachments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_row public.board_task_attachments;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_row from public.board_task_attachments where id = p_attachment_id and deletion_status = 'active';
  if not found then raise exception 'ATTACHMENT_NOT_FOUND'; end if;

  -- Attachment belongs to a board task visible to the signed-in user through the existing board RLS/contract.
  if p_display_name is not null and length(btrim(p_display_name)) = 0 then raise exception 'DISPLAY_NAME_REQUIRED'; end if;

  update public.board_task_attachments
     set display_name = case when p_display_name is null then display_name else nullif(btrim(p_display_name), filename) end,
         note = case when p_note is null then note else nullif(btrim(p_note), '') end
   where id = p_attachment_id
   returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.board_update_task_attachment_metadata(uuid,text,text) from public;
grant execute on function public.board_update_task_attachment_metadata(uuid,text,text) to authenticated;
commit;

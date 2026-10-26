-- Separate Dashboard/managed Storage owner authority; REVIEW ONLY.
-- Existing permissive ACL policies remain required. No UPDATE/upsert is added.
create policy attachment_lifecycle_select on storage.objects as restrictive for select to authenticated
 using(public.attachment_storage_permit(bucket_id,name,false));
create policy attachment_lifecycle_insert on storage.objects as restrictive for insert to authenticated
 with check(public.attachment_storage_permit(bucket_id,name,true));
create policy attachment_lifecycle_delete on storage.objects as restrictive for delete to authenticated
 using(public.attachment_storage_permit(bucket_id,name,false));

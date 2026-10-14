# TaskFlow private Supabase Storage: permission-safe installation

Status: candidate instructions only. Nothing in this plan has been installed in Production.

## Why the `.9.39` installation stopped

The reviewed candidate tried to create helper functions, insert a bucket row, and create RLS policies in Supabase-managed `storage`, and it granted `taskflow_migrator` access to the managed `auth`/`storage` schemas. The live permission preflight showed:

- `postgres`: non-superuser, has database `CREATE`, has `storage` `USAGE`, but does **not** have `storage` `CREATE`.
- `taskflow_migrator`: has `taskflow` membership reads, but no `storage` or `auth` schema `USAGE` and no `storage.objects` DML.
- `storage.objects` and `storage.buckets` are owned by `supabase_storage_admin`.
- `authenticated` already has the Supabase baseline Storage privileges and `auth.uid()` execution needed by Storage API policies.

Therefore the application migrations must not change managed schema/table ACLs or owners. `postgres` uses its existing database `CREATE` privilege only to create a new Zhuge-owned `taskflow_storage` schema. The real `taskflow_migrator` login installs narrowly scoped helper functions there. Supabase Dashboard's Storage UI creates the private bucket and policies, using its supported managed-schema path. No `GRANT` on `storage`, `auth`, or their tables is part of this plan.

The helper functions only return an authorization boolean. They derive the user from Supabase JWT claim settings and check workspace membership under the existing `taskflow_migrator` membership-read privilege. They do not call `auth.uid()` and need no Auth schema access. The helper schema must remain absent from the project's PostgREST exposed-schema list.

The live read-only inventory contained 13 existing storage.objects policies. All were limited to the existing board-task-attachments, knowledge-sources, or worktodo-attachments buckets and the authenticated role; no anon/PUBLIC or unscoped policy was present. Recheck the policy listing in every installation preflight and stop if that boundary changes.

The upload adapter uses Supabase's documented TUS resumable endpoint with `x-upsert=false`. Supabase documents `x-upsert=true` as the opt-in for overwriting an existing object; this plan therefore grants no Storage `UPDATE` policy. See [Supabase resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads) and [Storage access control](https://supabase.com/docs/guides/storage/security/access-control).

## One-time Production sequence after separate CTO/PM release approval

1. **Read-only preflight.** Connect as existing `postgres` and run `labs/taskflow/sql/taskflow_supabase_storage_preflight.sql`. Save the output. Stop unless it matches the permission facts above, the bucket does not already exist (or is exactly the reviewed private configuration), there are no pre-existing `taskflow_attachments_*` policy names, and both managed relation owners remain `supabase_storage_admin`. In Supabase Dashboard verify `taskflow_storage` is not in **Project Settings → API → Exposed schemas**, and the project-wide upload limit is at least 100 MiB. The SQL session GUC is diagnostic only and is not proof of the PostgREST configuration.
2. **Create the app-owned schema.** Through the controlled PostgreSQL session, connect directly as the current `postgres` login and run `taskflow_supabase_storage_schema_bootstrap.sql`. It checks `session_user = current_user = postgres`, no `SET ROLE`, database `CREATE`, and no `storage` `CREATE`; it creates only `taskflow_storage`, owned by `postgres`, grants `USAGE, CREATE` there to `taskflow_migrator`, and `USAGE` there to `authenticated`. It changes no managed owner or ACL.
3. **Install helpers as Migrator.** Open the existing controlled Migrator connection and verify `session_user = current_user = taskflow_migrator`; run `taskflow_supabase_storage_candidate.sql`. This creates exactly the two `SECURITY DEFINER` functions under `taskflow_storage`, with owner `taskflow_migrator`, fixed `search_path = pg_catalog, pg_temp`, and execution granted to `authenticated` only. The SQL itself rejects `SET ROLE`, storage/auth access, and missing TaskFlow membership reads.
4. **Create bucket in the supported UI.** In **Storage → New bucket**, create `taskflow-attachments`, keep it **Private**, set maximum file size to **100 MiB**, and leave MIME restrictions empty. Do not insert into `storage.buckets` directly.
5. **Create the three policies through the supported Dashboard Storage policy editor.** This uses Supabase's managed policy path; it must not be replaced with a `GRANT CREATE ON SCHEMA storage`, an owner change, or a SQL session that impersonates `supabase_storage_admin`. Apply only to `storage.objects`, target role `authenticated`, and use these expressions:

   - SELECT / `USING`:
     `bucket_id = 'taskflow-attachments' AND taskflow_storage.taskflow_storage_can_access_object(name)`
   - INSERT / `WITH CHECK`:
     `bucket_id = 'taskflow-attachments' AND owner_id = (select auth.uid()::text) AND taskflow_storage.taskflow_storage_can_access_object(name)`
   - DELETE / `USING`:
     `bucket_id = 'taskflow-attachments' AND taskflow_storage.taskflow_storage_can_delete_object(name, owner_id)`

   Do not add an UPDATE policy. Uploads use `upsert=false`; no overwrite permission is required. The project's baseline table grants remain unchanged. No anonymous policy is created. The only request identity is the authenticated Supabase JWT already verified by the TaskFlow API.

   If the Dashboard policy editor cannot create these policies under the current project permissions, stop there and retain the existing service. Do not fall back to broader database grants or owner changes.
6. **Read-only post-install gate.** Run `taskflow_supabase_storage_installation_verification.sql` as `postgres`. Confirm function owner/`SECURITY DEFINER`/search path/EXECUTE ACL, private bucket settings, exact policy set, unchanged managed table owners, and no `taskflow_migrator`/runtime Storage DML. Verify again in the Dashboard that `taskflow_storage` is not API-exposed. Any mismatch blocks deployment.
7. **Configure and release only after all database gates pass.** Confirm the existing non-secret/runtime settings are present without revealing values: `ZHUGE_SUPABASE_URL`, `ZHUGE_SUPABASE_ANON_KEY`, and `TASKFLOW_STORAGE_PROVIDER=supabase`. The adapter must use the existing publishable/anon key plus the current user's verified JWT; never add a `service_role` or secret key. Deploy the exact reviewed API/Web/Shell source and new release identity, then test upload/read/preview/download/delete with an authorized QA account before opening normal attachment traffic. This document does not authorize Production installation, environment changes, or deployment.

## Rollback

- **Before the first object is written:** stop the release, remove only these three TaskFlow policies in Storage → Policies, run the helper rollback as the real Migrator, then run optional `taskflow_supabase_storage_schema_rollback.sql` as `postgres`. The schema rollback refuses to remove a non-empty or differently owned schema. Keep the private bucket unless a separate inventory confirms it is empty and removal is approved.
- **After any object is written:** never remove the bucket or blobs and never roll back to a local-only attachment adapter. First restore a reviewed application image that understands the same Supabase bucket/object keys (the `.9.39` adapter is the rollback image candidate), or forward-fix the adapter. Keep policies/helpers until no active application version depends on them. No attachment metadata or file is deleted by rollback.
- If the preflight, Dashboard policy UI, or post-install verification cannot complete exactly as described, stop before deployment. Do not grant a managed-schema privilege to make the SQL pass.

## Validation boundaries

- The GitHub/local isolated PostgreSQL test creates managed-schema stand-ins owned by `supabase_storage_admin` and runs the bootstrap/helper SQL as distinct restricted logins. It also simulates Dashboard-created bucket/policies to test actual RLS behavior.
- It proves SQL compatibility with the known permission model; it does not execute against Production or prove Supabase Dashboard UI state.
- The Supabase Data API exposed-schema list and upload limit require explicit Dashboard verification; they cannot be certified by a SQL session GUC.
- The attachment adapter remains private: it uses the existing Supabase URL/anon key plus a per-user verified JWT, TUS upload with `upsert=false`, and short-lived signed reads. Preview/download errors fail closed; they never fall back to a public bucket or ephemeral local file for an object routed to Supabase.

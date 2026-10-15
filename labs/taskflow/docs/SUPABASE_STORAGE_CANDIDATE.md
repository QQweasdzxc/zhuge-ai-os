# TaskFlow private attachment Storage candidate

Status: candidate source only; this revision has not changed Supabase Production, created a bucket, installed Storage policies, deployed an application, or modified any existing attachment row/object.

## Design

- New TaskFlow attachment objects use one private Supabase bucket: taskflow-attachments. The reviewed maximum is 50 MB (50,000,000 bytes) per object, matching the native TaskFlow limit. The project-wide upload cap must be checked in Dashboard before installation; this candidate does not change it.
- Existing TaskFlow attachment rows remain in taskflow.attachment. Existing upload, authorization, metadata, preview, download, and delete handlers remain the application path. No attachment record is deleted or rewritten here.
- Native object keys remain workspaces/{workspace_uuid}/{attachment_uuid_v7}.{ext} or users/{user_uuid}/{attachment_uuid_v7}.{ext}. Avatar, source-context, external integration media, and legacy Render-local paths remain outside this bucket. Legacy local objects are not recoverable from metadata alone.
- The API first authenticates the TaskFlow request. For attachment endpoints only, the browser forwards the Zhuge Supabase access JWT in X-Zhuge-Storage-Token; the API verifies it against Supabase Auth /auth/v1/user, matches the verified UUID to the TaskFlow identity, and adds it to request context. A TaskFlow API JWT is never treated as a Supabase token.
- The handoff removes the JWT from the URL fragment before storing it in tab-scoped sessionStorage. The token is sent only in an attachment API header, never in a query, persistent browser storage, application log, or signed URL.
- The adapter uses the existing Supabase URL and anon/publishable key plus the verified per-user JWT. It rejects service-role/secret keys and has no S3 key, service-role credential, R2, or ephemeral local fallback for TaskFlow attachment keys.
- Uploads use Supabase TUS resumable upload with 6 MiB chunks and upsert=false, followed by same-user metadata read-back and size comparison. Preview/download use short-lived signed URLs after TaskFlow membership and Supabase RLS checks.

## Permission-safe installation

The .9.39 install candidate attempted to create functions, bucket rows, and policies inside Supabase-managed storage, and granted taskflow_migrator access to storage/auth. Live read-only preflight instead showed postgres has database CREATE but no storage CREATE; taskflow_migrator has no storage or auth USAGE; Storage relations are owned by supabase_storage_admin.

The corrected installation has three separate authorities:

1. taskflow_supabase_storage_schema_bootstrap.sql runs as the existing postgres login and creates only a new Zhuge-owned taskflow_storage schema. It grants USAGE, CREATE there to taskflow_migrator and USAGE there to authenticated. It does not touch managed schema/table ACLs or owners.
2. taskflow_supabase_storage_candidate.sql runs through a direct taskflow_migrator login. It rejects SET ROLE, uses only the TaskFlow helper schema and approved catalogs, creates two SECURITY DEFINER boolean helpers with a fixed pg_catalog, pg_temp search path, and grants function execution to authenticated only. The helpers read the JWT subject from PostgREST claim settings and check taskflow.member; they do not access auth or storage.
3. Bucket creation and RLS policy creation are performed through Supabase Dashboard Storage → Buckets / Policies, because the application migration identities cannot own or create in the managed storage schema. The bucket is private. The SELECT, INSERT, and DELETE policies are scoped to taskflow-attachments; there is no UPDATE policy because uploads use upsert=false. The exact expressions and UI checks are in SUPABASE_STORAGE_INSTALL_PLAN.md.

The helper schema must not be listed under Supabase Project Settings → API → Exposed schemas. The helper functions return only a boolean, but exposing them would create an unnecessary RPC surface. This Dashboard setting cannot be certified by a SQL session GUC, so it is a pre-deployment manual gate.

No permission is added to storage, auth, taskflow.member, or taskflow_runtime; no existing owner is changed. authenticated receives only usage of the new helper schema and execute on its two boolean helpers. Storage object row access remains limited by the bucket-specific RLS policies and the existing JWT identity.

## Preview, download, and failure behavior

- Authorized PDF/image preview and download use a short-lived signed URL or the authenticated content route; the user JWT is never embedded in the signed URL.
- For an object routed to Supabase, every storage failure—including untyped transport errors—must return a safe error response. The handler does not fall through to a direct/public URL or Render-local object path.
- Upstream response bodies, credentials, and provider details are not returned to the user. Authorization failures map to 403, missing objects to 404, size/throttle errors remain 413/429, and other provider/transport failures map to 502.
- The candidate tests the error translation and overlay early-return contract. Actual Supabase PDF/image preview, download, resumable upload, and API-restart durability remain NOT VERIFIED until the approved Dashboard installation and runtime acceptance occur.

## Existing attachment and PPTX status

The reported ZG-9 PDF and ZG-10 images had metadata but Render reported local GetReader: no such file or directory. Render Free local files are ephemeral. No alternate byte-for-byte source was confirmed, so the existing file contents are not yet confirmed recoverable. This candidate does not delete, rewrite, or claim to restore those records.

The historical 13.5 MiB PPTX HTTP 500 has no reproduced production root cause. TUS is the chosen upload mechanism and supports the candidate size, but that does not prove the past failure is fixed. Preserve the separate investigation item and capture a request ID plus sanitized backend/Storage status during authorized runtime acceptance.

## Rollback

- Before the first new Supabase object is written: stop the release, remove only the three TaskFlow policies through Storage → Policies, drop the helper functions using the Migrator rollback, and optionally remove the empty app-owned helper schema. Keep the private bucket unless a separate inventory confirms it is empty and its removal is approved.
- After an object is written: do not delete the bucket/blobs and do not roll back to a local-only adapter. The .9.39 application image remains the compatible-code rollback candidate because it uses the same Supabase bucket/object key contract; retain the bucket and policies. If the problem is in Supabase access itself, keep a storage-compatible application version active and forward-fix rather than switching to ephemeral local storage.
- The SQL rollback drops only TaskFlow-owned helper functions. It refuses a different database identity. The separate schema rollback removes only an empty taskflow_storage schema owned by the expected bootstrap login. Neither rollback deletes attachment metadata or object data.

## Current validation boundary

- Isolated PostgreSQL integration uses separate restricted login roles for schema bootstrap, helper installation, and managed Storage policy installation. It verifies actual RLS access/denial behavior and that managed owners and grants remain unchanged.
- The test emulates the reviewed hosted ACLs; it does not install against Production or certify Dashboard policy state.
- Preflight SQL, post-install verification SQL, Dashboard policy steps, and a forward-compatible rollback are provided.
- Runtime preview/download/upload, Production API health, and survival across Render restart remain NOT VERIFIED pending separate installation/release approval.
- Supabase Storage is durable object storage, not an independent backup guarantee. Existing Render-local files are not migrated by this candidate.

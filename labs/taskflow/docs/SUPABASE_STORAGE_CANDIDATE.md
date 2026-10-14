# TaskFlow private attachment Storage candidate

Status: candidate source only; no bucket, RLS policy, project setting, secret, or production object was created or changed.

## Design

- New writes use one dedicated private Supabase bucket: `taskflow-attachments`.
- Existing TaskFlow attachment rows remain in `taskflow.attachment`; the existing upload, authorization, metadata, preview, download, and delete handlers remain the application path.
- Native attachment object keys retain their existing scope shapes: `workspaces/{workspace_uuid}/{attachment_uuid_v7}.{ext}` and, where a request has no workspace, `users/{user_uuid}/{attachment_uuid_v7}.{ext}`. Avatar and non-attachment paths remain on the existing local Storage adapter. Legacy Render-local URLs are marked as legacy and are never mistaken for new Supabase objects.
- TaskFlow authenticates its API request first. For attachment endpoints only, the browser also forwards the Zhuge Supabase access JWT in `X-Zhuge-Storage-Token`. The API validates it against Supabase Auth `/auth/v1/user`, compares that UUID to the authenticated TaskFlow `X-User-ID`, and adds it to request context only after a match. A TaskFlow API JWT is never treated as a Supabase token.
- The Supabase JWT is carried only in the handoff URL fragment, which is removed immediately by the static handoff page, stored in tab `sessionStorage`, and sent only as an attachment API header. It is not placed in a query, API log, persistent browser storage, or a signed URL. The API logs neither the header nor upstream response bodies.
- The adapter uses the existing Supabase URL and anon/publishable key, plus the verified per-user JWT. It rejects Supabase service-role/secret keys. It does not use S3 static credentials, service-role credentials, R2, or Render local storage.
- Uploads use Supabase TUS resumable upload through the project-specific Storage hostname with 6 MiB chunks, followed by same-user metadata read-back and size comparison. The application and candidate bucket cap retain Multica's existing 100 MiB object limit; the API request parser allows a small multipart-framing margin. The project-wide Supabase Storage upload limit must be verified as at least 100 MiB before installation; this candidate does not change it.
- Preview/download use short-lived same-origin Supabase signed URLs generated only after the attachment handler's existing TaskFlow membership checks and Supabase RLS checks. Text preview and direct download proxy routes carry the verified user token.

## Authorization boundary

`taskflow_supabase_storage_candidate.sql` adds only policies for the `taskflow-attachments` bucket. The `SECURITY DEFINER` helpers live in the existing `storage` schema, derive `auth.uid()` themselves, and never accept a caller-supplied user id. The SQL does not grant authenticated users USAGE on the whole `taskflow` schema. It requires the migrator to have no pre-existing Storage CREATE permission, adds it only inside the transaction to transfer the two helper functions, then revokes it. Workspace paths require a row in `taskflow.member`; user paths require the path UUID to match `auth.uid()`. Both path classes accept only UUIDv7 attachment filenames. Deletion permits the Storage owner for user-scoped files, or the Storage owner/workspace owner/admin for workspace files. No table DML grant is added to `authenticated`, `anon`, `taskflow_runtime`, or `taskflow_migrator`. The Storage helper reveals only a membership boolean for a supplied workspace UUID; it does not return TaskFlow rows.

The SQL also grants `taskflow_migrator` usage on the `auth` schema and execute on the single `auth.uid()` function because the least-privilege helper owner needs to resolve the JWT identity. This is a narrowly scoped candidate privilege and must be reviewed against the current Auth ACL before installation. Installing policies and creating the bucket modifies Supabase's `storage` schema and requires a controlled Supabase database administrator path; it must not be run as `taskflow_runtime` and this candidate did not execute it.

The private bucket is limited to the native 100 MiB per-object cap, has no MIME allowlist, and is unique to TaskFlow. Existing `board-task-attachments`, `knowledge-sources`, and `worktodo-attachments` are never changed. Existing bucket/project quotas, current storage usage, the project-wide upload limit, plan-specific price, and the production bucket configuration still require a read-only preflight before a separate installation approval. No additional paid service is introduced by the code candidate, but storage consumption may be billable or quota-limited under the existing Supabase plan.

## Old local attachments and durability

Render Free's old local filesystem is ephemeral. The reported ZG-9 PDF and ZG-10 images have attachment metadata but no readable local object; this candidate does not recover, rewrite, or delete those records. No separate source copy was confirmed. If the old bytes are absent from all existing Render instances/backups, the metadata alone cannot reconstruct them.

New objects in Supabase Storage survive API/container restarts and do not depend on Render's local disk. This is durable object storage, not a backup/archive guarantee: Storage object versioning and independent backup retention are not established here. Deleting a blob is not automatically reversible. No current objects are migrated by this candidate.

## Rollback and release sequencing

1. Do not deploy the image until the private bucket and exact RLS policies have passed separate review and installation approval.
2. Before the first Production upload, preserve the current `.9.38` image/deployment anchor and record a masked non-secret environment snapshot.
3. Once any attachment row references the Supabase object URL, a rollback to `.9.38`'s Render-local-only adapter will not read that object. Rollback must therefore be forward-compatible: restore the candidate adapter/policies or deploy a reviewed compatibility build that can read the Supabase bucket. Never delete the bucket or blobs during rollback.
4. The SQL rollback file removes only TaskFlow policies and helper functions. It deliberately leaves bucket and objects intact. It should only be run after application traffic has returned to a compatible provider and a storage inventory confirms no referenced objects depend on these policies.

## Current acceptance limits

- CI uses isolated HTTP test servers and synthetic identity strings; it does not connect to the real Supabase project or create a bucket.
- Production PDF/image preview, download, upload, and API-restart survival remain NOT VERIFIED until the approved bucket/RLS setup exists and one controlled runtime acceptance is authorized.
- The historical 13.5 MiB PPTX HTTP 500 has no reproduced production root cause. TUS provides a synthetic-tested candidate path for that file size, but it does not prove that past 500 was fixed.
- User-authenticated native attachments (workspace- and user-scoped UUIDv7 keys) are the only paths moved to Supabase. Avatar, source-context and external integration media paths retain the existing local Storage behavior. Agent/daemon workspace attachment uploads lack a Zhuge Supabase user JWT and fail closed; Agent Runtime is deferred, so enabling these later requires a scoped service identity rather than service-role credentials or impersonating a human.
- Supabase Auth access JWTs expire. This candidate does not retain or forward refresh tokens. After expiration, the user must re-enter TaskFlow through the Zhuge handoff to refresh the tab-scoped Storage JWT.

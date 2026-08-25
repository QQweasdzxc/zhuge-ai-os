# AI Board Progress Attachment Delete RPC Proposal

**Status: PM REVIEW REQUIRED — proposal only**

This document records the design needed to repair deletion of an AI Board
progress-note attachment. It is not a migration, SQL deployment, RPC change,
or runtime authorization change. No Cloud state is modified by this proposal.

## 1. Domain and scope

The affected records are rows in `board_task_attachments` with
`attachment_scope = 'progress_note'` and a non-null `activity_id`. General
task attachments remain in the existing `attachment_scope = 'task'` path.

## 2. Current failure and path

The shared progress attachment button currently reaches the AI Board handler,
which calls `board-read-service.deleteTaskAttachment()`. That service invokes
the general `board_request_delete_task_attachment` path. The existing
controlled function rejects a non-task scope with the error:

`Only general TASK attachments can be removed here`

The failure is therefore a domain-path mismatch, not a reason to relax the
existing general attachment authorization.

## 3. Proposed RPC boundary

After PM approval, add a dedicated controlled function with a name such as
`board_request_delete_progress_attachment`. The exact name remains subject to
the normal RPC naming review and must not be introduced from this proposal
alone.

## 4. Proposed payload

The candidate signature is a single attachment identifier plus the owning task
context when available, for example `p_attachment_id uuid` and
`p_task_id uuid`. The server must derive the activity relationship from the
canonical row rather than trusting a client-supplied scope or storage path.

## 5. Creator / owner authorization

The function must require a live authenticated session and use `auth.uid()`.
It must verify the same owner / creator contract used by the AI Board progress
write and edit paths. A client-supplied actor label, service-role token, or
browser-only flag must not substitute for the server-side identity check.

## 6. Scope and relationship validation

Before creating a deletion request, the function must verify that the row is
`progress_note`, has a valid `activity_id`, belongs to the requested task, and
is owned by the authorized actor. A `task` row must be rejected by this path,
and a progress row must not be accepted by the general task path.

## 7. Controlled write and audit

The operation should follow the existing request / finalize lifecycle: record
the controlled deletion state and preserve the audit trail. Direct table
`DELETE` from the client is not allowed. The UI should receive only the
controlled result and should not fabricate a successful removal.

## 8. Storage cleanup and finalize semantics

Storage removal must use the canonical Storage gateway and the server-approved
bucket/path recorded on the attachment. Finalization must be safe if the
object is already absent, and a failed storage operation must not falsely mark
the database record as successfully deleted.

## 9. RLS, grants, and security posture

The approved implementation must preserve RLS, explicit function grants, and
the existing security-definer/search-path review requirements. It must not
disable RLS, grant broad table write access, or use a service role to simulate
the creator. The new path must be domain-specific and least-privilege.

## 10. Read-back, errors, idempotency, and regression

The runtime should perform a controlled read-back after success, map server
errors without hiding them, and remain safe on repeated clicks or already
deleted rows. Regression must cover task-vs-progress scope routing, owner
authorization, RLS denial, storage cleanup, audit retention, AI Board and
WorkTodo separation, and UI refresh. PM approval is required before any SQL,
RPC, migration, or Cloud deployment is written.


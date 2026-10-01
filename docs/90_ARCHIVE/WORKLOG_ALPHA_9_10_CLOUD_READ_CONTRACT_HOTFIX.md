# Zhuge AI OS v0.9.0-alpha.9.10

Build: 20260803-1326
Base: v0.9.0-alpha.9.9
Status: Emergency Hotfix / UAT

## Problem

- Supabase contains WorkLog data, but the UI showed 0 tasks and 0 hours.
- Calendar navigation worked after alpha.9.9, but month data still did not appear.
- Production tables are `public.user_tasks` and `public.work_entries`.

## Supabase Verification

- Project: `lenpbbhwxyyfwgvjcozf` / QQ's Project / Production.
- Auth UUID and profile UUID: `ac5afcc7-f045-41a9-8827-eaf085a04c0d`.
- `public.user_tasks` contains cloud task records.
- `public.work_entries` contains cloud work-entry records.
- Legacy `public.worklog_tasks` and `public.worklog_entries` are empty and are not valid runtime sources.

## Root Cause

The runtime used correct table names, but critical reads were bundled into the broad hydration process. A failure or delay in unrelated optional domains could postpone the final render and leave critical arrays empty. Queries also relied only on RLS and did not explicitly bind `user_uuid`, making diagnosis and contract enforcement weaker.

## Changes

1. Added `DataService.loadCriticalData()` for Tasks and Work Entries.
2. Critical cloud rows are applied and rendered immediately before optional Knowledge, Journal, and Conversation domains complete.
3. `loadTasks()` explicitly filters `user_uuid` and `deleted_at IS NULL`.
4. `loadEntries()` explicitly filters `user_uuid`, month range, non-deleted status, and `deleted_at IS NULL`.
5. Optional-domain failures no longer mark the entire WorkLog core data status as failed.
6. No database schema, RLS, OAuth, Shared Identity, or module architecture changes.
7. Supabase remains the Single Source of Truth; no business data is restored to local storage.

## UAT Acceptance

- Tasks page displays cloud tasks for the authenticated UUID.
- July 2026 displays the existing cloud work entries and total hours.
- Switching July/August repeatedly does not clear data.
- Conversation or Knowledge failure does not hide Tasks or Work Entries.
- No calls to `worklog_tasks` or `worklog_entries` are introduced.

# Zhuge AI OS v0.9.0-alpha.9.8

Build: `20260803-1147`  
Previous Version: `0.9.0-alpha.9.6`  
New Version: `0.9.0-alpha.9.8`

## PM Decision

All Zhuge AI OS business data uses Supabase as the single source of truth. Browser storage must not act as a second database. Authentication material and non-business UI preferences may remain local.

## Problems Before This Version

1. WorkLog kept cloud-backed profile, work profile, entries, tasks, Knowledge and sync status in browser storage.
2. Browser cache and Supabase could disagree, causing the UI to show stale or empty data.
3. Historical month loading returned immediately while initial hydration was running. The query was never retried, so July displayed `0m` although Supabase contained 141 active entries and 184 hours for the user.
4. A stale local `wl_cloud_sync_status_v1` value could keep showing a red failure state after the database was healthy.
5. Task drafts were persisted locally, conflicting with the cloud-only data policy.

## Root Cause

`DataService.loadMonthEntries()` contained an early return whenever `dataServiceHydrating` was true. Login initialization and month navigation can happen concurrently. When July was requested during initialization, the request was silently discarded.

The earlier LocalCache design also allowed browser data and cloud data to coexist as competing sources of truth.

## Changes

### Cloud Single Source of Truth

- Profile, work profile, work entries, tasks, work models, ECP tasks, work journal, Knowledge sources, Knowledge units and recommendation candidates are no longer persisted through `LocalCache`.
- Runtime state starts empty and is populated from Supabase.
- Legacy cloud-backed browser keys are removed at startup and after successful cloud hydration.
- Cloud and Conversation health status are held in runtime memory instead of browser storage.
- `saveLocalSnapshot()` now stores only authentication/session shell data and UI preferences.
- Task drafts are memory-only and disappear when the page closes.

### Historical Month Loading

- Month loading now waits for cloud initialization instead of silently returning.
- A 10-second timeout produces a visible error rather than an empty result.
- The requested month is captured to prevent a slow response from overwriting a newer month selection.
- Successful reads return the cloud rows and update the health state.
- Failed reads preserve a precise Supabase error in the console and health state.

### Data Integrity

- Historical work entries continue to load by `work_date`; an inactive ECP task does not remove historical entries.
- Existing snapshots (`ecp_task_name_snapshot`, `task_title_snapshot`) remain the historical display source.
- This version does not delete or rewrite production work entries.

## Browser Storage Boundary

Allowed:

- Supabase authentication/session material
- active tab, sidebar and selected view preferences
- temporary OAuth/PKCE state

Not allowed:

- WorkLog entries
- user profile or work profile
- tasks, ECP tasks or work models
- Knowledge data
- Conversation data
- cloud health status as a persistent fact

## Supabase Verification

Before this fix, production verification showed for `qq.1025@gmail.com`:

- July active work entries: `141`
- July active hours: `184.00`
- The July ECP task was inactive, not physically deleted.

This confirmed the missing July UI was a frontend loading problem, not data loss.

## Files Changed

- `shared/app-state.js`
- `shared/api/data-service.js`
- `modules/worklog/worklog-app.js`
- version metadata and release-consistency tests

## UAT Checklist

1. Sign in in a normal browser window.
2. Open July immediately after WorkLog starts loading.
3. Confirm July displays 184 hours and its historical entries.
4. Refresh the page and confirm the same cloud data is shown.
5. Open DevTools > Application > Local Storage and confirm no WorkLog entries/profile/tasks/Knowledge cache is recreated.
6. Add or edit a work entry and verify it appears after a refresh on another browser session.
7. Confirm an inactive July ECP task does not hide July entries.
8. Confirm stale `wl_cloud_sync_status_v1` and `zhuge_conversation_sync_status_v1` keys are removed.

## Handover Notes

Do not reintroduce a browser business-data cache without explicit PM approval and a new ADR. Supabase is the business-data SSOT. UI memory may be used only as transient render state, never as durable data.

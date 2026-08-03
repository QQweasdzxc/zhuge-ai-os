# Zhuge AI OS v0.9.0-alpha.9.8

Build: `20260803-1147`  
Previous Version: `0.9.0-alpha.9.7`  
New Version: `0.9.0-alpha.9.8`

## Incident

After the v0.9.0-alpha.9.7 Cloud SSOT change, users reported:

1. Existing To-Do items displayed as zero.
2. WorkLog calendar month switching did not load cloud entries.
3. Cloud Sync and Conversation remained failed.

## Supabase Verification

The affected account still has cloud data:

- `user_tasks`: 7 active rows and 4 archived rows.
- July WorkLog: 141 active rows / 184 hours.

No emergency data restore was required. The incident was a frontend cloud hydration failure, not cloud deletion.

## Root Cause

### RC-1: Core data was applied too late

`DataService.loadAll()` fetched Tasks and Work Entries, but applied them only after optional Work Memory processing. Any later optional-domain exception could abort the method before `setTasksFromCloud()` and `setEntries()` executed.

Result: Supabase contained the records, but the UI remained empty.

### RC-2: Task save reconciliation was destructive

`saveTasks()` treated every cloud row missing from the current in-memory UI list as deleted. During partial hydration, an empty or incomplete UI list could archive valid cloud tasks.

This violated Cloud SSOT because a temporary client state could mutate cloud truth.

### RC-3: Optional AI domains affected perceived platform health

Conversation and Knowledge are optional domains. Their failures must be displayed separately and must not block or erase WorkLog core data.

## Fix

### Core-first cloud hydration

Tasks, monthly Work Entries, and Work Journal are applied immediately after their cloud reads, before optional Work Memory, Knowledge, and Conversation processing.

### Non-destructive Task persistence

Task absence from the current UI list is no longer interpreted as deletion. A task can only be archived or deleted by an explicit user action.

### Conversation isolation

Conversation loading remains background/optional and has its own status. It cannot change WorkLog core data or prevent the calendar and To-Do screens from rendering.

### Cloud SSOT retained

Business data remains cloud authoritative. No WorkLog, Task, Conversation, Knowledge, or Profile business data is restored from browser LocalStorage.

## Data Integrity Rule

A partial client hydration must never delete, archive, or overwrite cloud records.

## UAT Checklist

1. Sign in and open To-Do: the 7 active cloud tasks must appear.
2. Open WorkLog and switch July/August repeatedly.
3. July must show 141 entries and 184 hours.
4. A Conversation failure must not empty Tasks or Work Entries.
5. Refresh the page and verify the same cloud results.
6. Creating or editing one task must not archive unrelated cloud tasks.

## Remaining Follow-up

- Add explicit Cloud Health detail and retry controls.
- Remove misleading generic “Sync failed” wording when only an optional domain fails.
- Add automated regression coverage for partial hydration and non-destructive task saving.

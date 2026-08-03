# WorkLog v0.9.0-alpha.9.5 Optimization Record

Build: `20260803-1125`  
Previous Version: `0.9.0-alpha.9.4`  
New Version: `0.9.0-alpha.9.5`

## Purpose

This release addresses five issues reported during UAT and preserves the observed problem state, root cause, solution, and verification requirements for future developers.

## 1. Step 3 / 4 blocked users without a monthly assignment

### Problem

The monthly work task field was required before the user could proceed. At the beginning of a month, a manager may not have assigned the task yet.

### Root Cause

The Step 3 handler returned immediately when `setupEcpTask` was empty.

### Resolution

- Renamed the step to `本月工作任務（可稍後設定）`.
- Added `稍後設定`.
- Empty monthly task may proceed to confirmation.
- The flow remains a reminder, not a gate.

## 2. Historical July entries appeared empty

### Supabase Verification

For the account `qq.1025@gmail.com` / UUID `ac5afcc7-f045-41a9-8827-eaf085a04c0d`, Supabase still contains:

- July active entries: 141
- July active hours: 184.00
- July task `202607管理部月工作-採購及管理(含臨時交辧)` is inactive, not physically deleted.

### Root Cause

Month navigation could call `loadMonthEntries()` while initial Cloud hydration was running. The function silently returned, leaving the selected month with empty local cache data.

### Resolution

- Month loading now waits up to 8 seconds for initial hydration.
- It returns a success/failure result instead of silently skipping.
- Failure logging includes the Supabase response.
- Historical entries are loaded by `work_date`; they do not depend on the task being active.
- Existing `ecp_task_name_snapshot` remains the historical display source.

## 3. Work summary progress bars were decorative

### Problem

The visual bar always used a fixed 38% fill regardless of actual hours.

### Resolution

The bar now uses the calculated month/week/day percentages through `--summary-progress`.

## 4. Conversation Cloud continuously showed sync failure

### Root Cause

The frontend uses PostgREST upserts with:

- `on_conflict=user_uuid,thread_key`
- `on_conflict=user_uuid,client_message_id`
- `on_conflict=user_uuid,state_key`

The corresponding unique constraints/indexes were missing in Supabase.

### Resolution

Applied Supabase migration:

`docs/supabase/20260803_fix_conversation_upsert_constraints.sql`

The migration creates three unique indexes required by the existing Repository contract. RLS policies were confirmed present and user-scoped.

## 5. Investment status was inconsistent

### Problem

The root dashboard showed Investment as SIT, but the WorkLog sidebar and Agent status still showed `施工中`.

### Resolution

- Investment sidebar entry is enabled.
- Added `SIT` status badge.
- Clicking Investment opens `modules/investment/`.
- Investment Agent status changed from `施工中` to `SIT`.

## Architecture Boundaries Preserved

This release does not redesign:

- OAuth flow
- Shared identity flow
- Shared Platform boundaries
- WorkLog database schema
- Historical work entry model
- Investment module internals

## UAT Checklist

1. Leave Step 3 monthly task empty and select `稍後設定`.
2. Navigate to July 2026 and confirm 141 entries / 184 hours are available for the target account.
3. Confirm summary bars match displayed percentages.
4. Open Control Center and confirm Conversation changes to synced after refresh/message activity.
5. Confirm Investment shows `SIT` and opens the Investment module.
6. Confirm August task changes do not alter July work-entry snapshots.

## Version Mapping

- `0.9.0-alpha.9.4`: non-blocking final confirmation and background profile sync.
- `0.9.0-alpha.9.5`: optional Step 3, historical month load retry, real summary bars, Conversation upsert fix, Investment SIT status synchronization.

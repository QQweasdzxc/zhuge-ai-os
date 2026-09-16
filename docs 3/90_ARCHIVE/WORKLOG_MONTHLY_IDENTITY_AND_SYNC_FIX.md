# WorkLog Monthly Identity and Sync Fix

Version: `0.9.0-alpha.9.4`  
Build: `20260803-0955`  
Date: `2026-08-03`

## Problem Summary

1. The monthly work identity flow blocked users from entering WorkLog when the current month task was not yet assigned.
2. The confirmation action required immediate cloud sync. Expired JWT or temporary sync failures trapped the user in onboarding.
3. The label `修改` was ambiguous.
4. The setup used the currently selected calendar month instead of the actual current month when assigning `task_effective_month`.
5. Deactivating a July ECP task made it disappear from the active task list, creating the impression that July work entries were deleted.

## Supabase Findings

- Project: `QQ's Project`
- `work_entries` still contains July data.
- July totals at investigation time: 281 entries / 450.34 hours.
- August totals at investigation time: 1 entry / 1.00 hour.
- The July task `202607管理部月工作-採購及管理(含臨時交辧)` still exists in `user_ecp_tasks`, but `is_active = false`.
- The August task exists and is active.
- `work_entries` includes `ecp_task_name_snapshot`, so historical task names are available independently from the active task list.
- The observed `401 / PGRST303 / JWT expired` occurs before RLS or table processing; it is a Shared Session token refresh issue, not a table permission issue.

## Root Cause

### UX / Flow
The onboarding wizard was implemented as a hard gate. The `完成` action used `requireCloud: true`, so a cloud error prevented navigation even after local data had been saved.

### Monthly Context
`monthKey()` uses the selected calendar month. When users were viewing July during August, setup could save July as the effective month. This couples configuration to calendar navigation.

### Historical Visibility
The active ECP task query only returns rows where `is_active = true`. Removing a task deactivates it. It does not delete historical work entries, but UI logic can hide or fail to hydrate historical data when cloud sync is unavailable.

## Changes

1. Added `currentCalendarMonthKey()` and use it for monthly identity setup.
2. Reworded `目前工作任務` to `本月工作任務` in onboarding.
3. Reworded `修改` to `返回編輯`.
4. Reworded `確認` to `完成`.
5. Added `稍後設定`; users can enter WorkLog without a current task.
6. Completion now saves locally first and enters WorkLog immediately.
7. Profile and task cloud sync run in the background and no longer block navigation.
8. Sync failures remain visible in the control center and console for retry/diagnosis.
9. No database schema, RLS, OAuth flow, or Shared Platform boundary was changed.

## Data Safety Decision

- Historical WorkLog entries must not be deleted when an ECP task becomes inactive.
- Task removal means `inactive`, not physical deletion.
- Historical display and export should prefer `ecp_task_name_snapshot` when the referenced task is inactive or unavailable.
- July and August task assignments must be treated as separate monthly context.

## Known Remaining Issue

`Shared Session Refresh` still needs a dedicated platform fix. A stale JWT can cause `401 PGRST303 JWT expired`. This patch prevents that platform failure from blocking WorkLog onboarding, but does not redesign OAuth or Shared Session.

## Verification Checklist

- New user can select `稍後設定` and enter WorkLog.
- User can complete setup while offline or during temporary cloud failure.
- Effective month always uses the actual current month.
- Switching calendar to July does not change August work identity.
- July work entries remain present after July ECP task is inactive.
- Control Center reports unsynced status without blocking WorkLog.

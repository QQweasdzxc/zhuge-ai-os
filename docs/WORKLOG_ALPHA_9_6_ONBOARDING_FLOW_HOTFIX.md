# WorkLog v0.9.0-alpha.9.7 Onboarding Flow Hotfix

Build: `20260803-1125`  
Previous Version: `0.9.0-alpha.9.5`  
New Version: `0.9.0-alpha.9.7`

## Problem Status

In v0.9.0-alpha.9.5, the work identity onboarding was described as non-blocking, but the actual state machine still contained blocking conditions.

Observed behavior:

1. Selecting **完成** with no monthly task displayed `尚未完成工作身分：目前工作任務`.
2. Selecting **稍後設定** returned to the welcome screen and created an endless loop.
3. Selecting **返回編輯** returned to Step 3, but Step 3 did not provide a real exit path into WorkLog.

## Root Cause

### 1. Welcome condition ignored the deferred state

`needsWorklogWelcome()` checked whether the work profile was complete, but did not honor `WORKLOG_WELCOME_KEY`. A user could defer onboarding, yet the next render still considered the profile incomplete and reopened onboarding.

### 2. Empty monthly task was still treated as invalid

The completion handler called `isWorkProfileReady(next)`. That function requires `defaultTask`, contradicting the PM decision that the monthly assignment is optional when the supervisor has not assigned work.

### 3. Completion screen depended on a fully ready profile

The handler set `WORK_IDENTITY_COMPLETION_KEY`, but the completion screen was displayed only when `isWorkProfileReady(workProfile)` was true. With an empty monthly task, the step key had already been cleared, so the UI fell back to the first welcome screen.

### 4. Step 3 defer action only moved to Step 4

The Step 3 defer button did not leave onboarding. It merely wrote an empty task and moved to confirmation, so it was not a true non-blocking action.

## Resolution

### Onboarding is now one-time and non-blocking

`needsWorklogWelcome()` now follows these rules:

- No authenticated session: do not render onboarding.
- Explicit completion screen pending: render it.
- Onboarding already completed or deferred: enter the product directly.
- Otherwise: show the first-time guide.

### Monthly task is optional

The **完成** action saves the available identity fields and opens WorkLog even when the monthly task is empty. Background cloud synchronization remains best-effort and does not gate product access.

### Real exit paths

- Step 3: **先使用 WorkLog** exits onboarding immediately.
- Step 4: **先使用 WorkLog** exits onboarding immediately.
- Step 4: **完成** saves the current draft and opens WorkLog immediately.
- **返回編輯** still returns to Step 3 by definition, but Step 3 now has a direct product-entry action.

### Loop prevention

All exit paths now:

- Set `WORKLOG_WELCOME_KEY = 1`.
- Remove `WORK_IDENTITY_COMPLETION_KEY`.
- Remove onboarding step and draft keys.
- Set active workspace to `worklog`.
- Save OS shell state before rendering.

## Architecture Scope

Not changed:

- Google OAuth flow
- Shared Session architecture
- Supabase schema or RLS
- Module structure
- WorkLog data model
- Release strategy

This is a frontend onboarding state-machine hotfix only.

## UAT Checklist

1. Start onboarding and leave the monthly task empty.
2. At Step 3, select **先使用 WorkLog**. Confirm WorkLog opens and onboarding does not reopen after refresh.
3. Repeat with Step 4 **先使用 WorkLog**.
4. Repeat with Step 4 **完成** and an empty monthly task. Confirm WorkLog opens without an error toast.
5. At Step 4 select **返回編輯**, then select **先使用 WorkLog** at Step 3.
6. Refresh the browser and reopen `/modules/worklog/?app=1`. Confirm no onboarding loop.
7. Open Settings to complete or update the monthly assignment later.

## Version History

- `0.9.0-alpha.9.5`: optional-task UI wording and initial non-blocking attempt.
- `0.9.0-alpha.9.7`: fixes the onboarding state loop and makes all defer/complete paths truly non-blocking.

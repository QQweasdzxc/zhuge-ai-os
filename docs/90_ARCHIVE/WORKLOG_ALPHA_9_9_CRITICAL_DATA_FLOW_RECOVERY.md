# Zhuge AI OS v0.9.0-alpha.9.9

Build: 20260803-1244

## Status
Critical hotfix based on v0.9.0-alpha.9.6. Versions alpha.9.7 and alpha.9.8 are QA failed and are not used as the baseline.

## Confirmed cloud data
- Supabase remains the Single Source of Truth.
- Existing Tasks and Work Entries were not deleted by this patch.
- Browser business-data cache is disabled. Authentication session and UI preferences remain allowed.

## Root causes addressed
1. Month switching called `loadMonthEntries()` while the initial cloud hydration flag was true. The old implementation silently returned, so no month query was issued and the UI remained empty.
2. Critical Tasks and Work Entries were fetched but applied only after optional Work Journal, Knowledge, and Conversation operations. An optional-domain failure could therefore prevent critical data from reaching the UI.
3. Business data was still written to local browser cache, producing two competing states.

## Fixes
- Month requests wait for current cloud initialization to finish instead of silently returning.
- Stale month responses are ignored when the user changes month quickly.
- Tasks are applied immediately after their Supabase query succeeds.
- Work Entries are applied immediately after their Supabase query succeeds.
- Conversation and Knowledge failures are isolated and cannot hide Tasks or Work Entries.
- Browser business-data cache and profile/work-profile snapshots are disabled.
- No schema, OAuth flow, Shared Identity flow, or RLS policy was changed.

## UAT
1. Login and open WorkLog.
2. Confirm cloud Tasks appear.
3. Click Previous Month and verify the month label changes.
4. Verify 2026/07 loads cloud Work Entries.
5. Rapidly switch July/August and confirm stale responses do not overwrite the selected month.
6. Confirm an optional Conversation error does not clear Tasks or Work Entries.
7. Refresh and confirm data is loaded again from Supabase.

## Rollback
Rollback baseline is v0.9.0-alpha.9.6. Do not roll back the Supabase database because this hotfix performs no database mutation.

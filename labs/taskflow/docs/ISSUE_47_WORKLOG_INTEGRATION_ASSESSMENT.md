# Issue #47 — TaskFlow Apps and WorkLog integration assessment

## Phase A candidate boundary

The TaskFlow sidebar overlay adds an **Apps** group to the staged Multica
`app-sidebar.tsx` copy. Each link targets the canonical Zhuge AI OS Pages origin
and opens a new tab, leaving the TaskFlow tab available as the return path.
The links carry no token, cookie, or other credential. Both applications use
the existing Zhuge browser session on the same origin.

| Entry | Candidate route | Source/runtime status |
| --- | --- | --- |
| AIOS Dashboard | `/app/dashboard/` | Transition entry; existing AIOS surface |
| WorkLog | `/modules/worklog/?app=1&workspace=worklog` | Existing module; source includes cloud-backed work entries, calendar, summaries, and ECP export. Candidate link is not a live authenticated browser acceptance. |
| Knowledge | WorkLog `workspace=library` | Existing WorkLog workspace, not an independent module |
| Management | WorkLog `workspace=management` | Existing WorkLog workspace, not an independent module |
| Lab Center | `/labs/` | Existing Lab Center |
| Investment Lab | `/labs/investment/` | Active Lab registry entry, still marked experimental / production runtime review |
| Official Investment | No link | Parked; not represented as available |
| SkyEye | `/modules/skyeye/` | Source entry exists; runtime not verified |

The old AIOS Dashboard entry remains during transition. No legacy module,
database, route, or TaskFlow sidebar source is removed. Frozen Multica and
Native Lab source remain unchanged; the Apps UI and locale additions are
applied only to the TaskFlow staged build source.

## WorkLog source audit for Phase B

The current WorkLog entry is `modules/worklog/index.html`; `?app=1&workspace=`
selects the dashboard, worklog, library, management, sync, or settings surface.
The existing app includes:

- Cloud persistence through the shared `DataService` / repositories for
  `public.work_entries`, using the current Zhuge user and existing row-level
  ownership rules (`worklog-app.js` `persistEntry`).
- Monthly calendar cell generation and daily/monthly work-hour presentation
  (`worklogCalendarCells`, `calendarPanel`, `mobileCalendarPanel`).
- Work summaries and analysis already composed in the WorkLog UI.
- ECP export (`exportEcpImportFile`) and its existing template/profile.
- Historical work-entry loading and editing through the existing repository.

This is a source-level inventory, not a new production-data read or live
authenticated acceptance. No WorkLog data was converted to TaskFlow issues.

## Minimum Phase B approach

After Phase A is accepted, prototype a TaskFlow-owned WorkLog route that mounts
the mature WorkLog presentation and business modules inside the TaskFlow
content area while continuing to call the existing DataService and
`public.work_entries` authority. Keep current authentication, validation,
export code, and stored row shape. Reuse the existing WorkLog calendar logic
and make only the smallest entry-point/layout adapter needed for TaskFlow.
Do not iframe the separate page, copy records into TaskFlow, translate hours
into issues, move the WorkLog schema, or rewrite the calendar/export engine.

Validate the adapter in an isolated build with synthetic data first. Only after
Phase A review should a separate Phase B candidate cover create/edit, calendar,
summary, ECP export, historical data read, refresh, and mobile behavior.

## Current evidence and gaps

- Phase A patch contract tests pass for route origins, truthful module states,
  locale keys, and fail-closed source markers.
- No live browser with a Zhuge authenticated session was available in this
  candidate QA, so clicking through Tasks/WorkLog and confirming the shared
  session remains **NOT VERIFIED**.
- Desktop/mobile interaction acceptance and live app availability remain
  runtime gates; the contract test is not browser acceptance.
- No Phase B WorkLog code or data behavior is changed by this candidate.

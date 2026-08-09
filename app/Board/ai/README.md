# Zhuge AI OS — AI Board

## Purpose
The formal Board runtime reads `public.board_tasks` and approved principles from
`public.engineering_knowledge` through the Shared Identity and Shared
Supabase Data Gateway.

## How to use
Sign in to Zhuge AI OS, open the Dashboard, and choose **AI Board**. The Board
expects the existing Shared Session and should be served from the repository
host rather than opened as an isolated local file.

## Controlled interactions
- Collapse / expand the global left navigation (Sidebar ↔ Icon Rail)
- Refresh the formal cloud projection
- Review the fixed `📘 最高原則` area
- Review Cloud TASK cards mapped to 待辦 → 推進 → 驗證 → 完成
- Search TASKs by code, title, requirement, usage scenario, or assignee
- Review the ordered TASK detail: requirement → usage scenario → checklist/evidence → next action
- See the current assignee on each card

Task creation, drag status changes, assignee changes, and Checklist evidence
use only the approved controlled RPC boundary. The browser never writes Board
tables directly. GPT and Co remain AI workflow actors and do not receive
Supabase Auth users or UUIDs. Custom workspace management remains out of scope.

## Board model
固定區 | 可移動、可新增區
📘 最高原則 | 待辦 → 推進 → 驗證 → 完成

## Notes
This is the formal Cloud Board slice. It does not use Mock Data, task
LocalStorage, or an independent Supabase client. The legacy `app.js` remains
unloaded historical source only; it is not part of the Board runtime.
Related approved slices: TASK-001, TASK-005, TASK-015, TASK-016, TASK-021,
TASK-022 and TASK-023.

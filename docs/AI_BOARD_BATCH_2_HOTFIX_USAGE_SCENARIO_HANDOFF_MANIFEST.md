# AI Board Batch #2 Hotfix — Usage Scenario GPT Review Handoff

Artifact type: **GPT Review Candidate**  
Development Batch: **AI Board Operational Workflow & Engineering Handoff — PM QA FAIL Hotfix**  
Product Version: `v0.9.0-alpha.9.12`  
Runtime / Source Build: `20260809-2038`
Artifact timestamp: `20260809-2038`

## Artifacts

- Source: `20260809_2038_ZhugeAIOS_v0.9.0-alpha.9.12_AI_Board_Batch2_Hotfix_SharedNavigation_Source.zip`
- GPT Review Candidate: `20260809_2038_ZhugeAIOS_v0.9.0-alpha.9.12_AI_Board_Batch2_Hotfix_SharedNavigation_GPT_Review_Candidate.zip`

Artifact timestamp and Runtime Build timestamp are identical. This is a review
candidate, not a Release. `main` is not merged and GitHub Pages is not deployed.

## Covered scope

- Search is a live filter over TASK code, title, requirement, usage scenario, and assignee.
- 全部工作 and Engineering Center navigation have real pointer/keyboard behavior and feedback.
- The prototype-only Interactive Prototype v0.9 presentation is removed from the formal Board entry; legacy files are not loaded.
- Highest Principles is fixed and has no invalid add-card entry.
- TASK detail order is requirement → usage scenario → Development Contract／PM QA Checklist / Evidence → next action.
- `board_tasks.usage_scenario text` is persisted by the approved `board_create_task` RPC; historical NULL values render as `尚未補充使用情境`.
- Create TASK modal collects requirement, usage scenario, and title with explicit success/failure feedback.
- TASK-024 reuses the existing `ZhugeSharedNavigation` component and WorkLog Shell classes around AI Board; direct links open WorkLog, 待辦事項, Investment, Knowledge, 控制台, and 設定 without Browser Back.

## Evidence

- Developer QA: `docs/AI_BOARD_BATCH_2_HOTFIX_DEVELOPER_QA.md`
- QJC persona walkthrough: `docs/AI_BOARD_BATCH_2_HOTFIX_QJC_PERSONA_WALKTHROUGH.md`
- Approved schema/RPC migration: `docs/supabase/20260809_ai_board_batch_2_usage_scenario.sql`
- Browser regression: `tests/ai-board-batch-2-browser.test.js`
- Static/data regression: `tests/ai-board-batch-2.test.js`, `tests/ai-board-cloud-read.test.js`

## Handoff state

Co Developer QA: **PASS**  
GPT Review: **NEXT**  
QJC PM QA: **HOLD until GPT PASS**  
TASK final Done: **NO**  
Production deploy: **NO**  
Database Migration: **approved usage_scenario column/RPC only**  
OAuth / Session / WorkLog Logic: **NO CHANGE**

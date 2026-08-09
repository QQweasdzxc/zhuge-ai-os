# AI Board Batch #2 Hotfix — QJC Persona UI/UX Walkthrough

This is a Developer QA walkthrough that follows the way QJC should use the
formal AI Board. It is evidence for GPT Review; it is not a substitute for
QJC's final live PM QA.

## Walkthrough

1. Open the Zhuge AI OS Dashboard and select **AI Board**.
   - Expected: the formal Board loads from authenticated Shared Identity and
     Supabase Cloud data; no prototype fixture is shown. The Zhuge AI OS
     Shared Navigation remains visible around the Board content.
2. Use the search field to enter `TASK-026` (or a usage-scenario phrase).
   - Expected: the task cards filter immediately and the result count is shown.
3. Open the `TASK-026` card.
   - Expected detail order is:
     1. 需求內容
     2. 使用情境 (or `尚未補充使用情境` for historical NULL data)
     3. Development Contract／PM QA Checklist with status and Evidence
     4. 下一步 actions allowed by the current Status and Assignee
4. Read the Checklist rows.
   - Expected: each Co / GPT / QJC item has a check state, required marker,
     Evidence display, and explicit PASS/FAIL/Evidence controls.
5. For `qa / GPT`, inspect the handoff actions.
   - Expected: `退回 Co` and `GPT Review 通過 → 交 QJC` are clear; a direct
     PM completion action is not presented to GPT.
6. Use Shared Navigation to click **WorkLog**, **待辦事項**, **Investment**,
   **Knowledge**, **控制台**, and **設定**.
   - Expected: each link has a real destination; WorkLog links open the
     requested internal workspace directly. Browser Back is not required.
7. Use the Board-private navigation to click **全部工作** and
   **Engineering Center**.
   - Expected: each item scrolls to its real section and produces a visible
     confirmation banner. No clickable item is a no-op.
8. Click **＋ 新增 TASK** in 待辦.
   - Enter a requirement, a concrete 使用情境, and a title, then submit.
   - Expected: the modal closes only after the controlled create operation
     succeeds; a success or failure banner is always shown.
9. Verify the usage-scenario persistence path against the authenticated
   Supabase environment:
   - Create TASK → `board_tasks.usage_scenario` is written → reopen detail →
     scenario is visible → refresh → scenario remains.
   - Existing records with NULL are shown as `尚未補充使用情境`; no scenario is
     invented for historical TASKs.
10. Confirm the fixed **最高原則** area has no add-card control and there is no
   unavailable **新增工作區** action.

## Evidence status

- Browser fixture walkthrough: **PASS**.
- Static/Node regression for search, detail ordering, scenario mapping, and
  unavailable controls: **PASS**.
- Live authenticated QJC create/refresh verification: **QJC/GPT deployment QA
  required next**; Co does not claim this as final acceptance.

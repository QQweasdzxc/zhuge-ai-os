# Zhuge AI OS — AI Board Interactive Prototype v0.9

## Purpose
Interactive prototype for PM review and TASK-025 validation.

## How to use
Open `index.html` in Chrome on a desktop computer.

## Prototype interactions
- Collapse / expand the global left navigation (Sidebar ↔ Icon Rail)
- Add cards from the global `新增卡片` entry
- Quick-add cards from the top of each workspace
- Add cards to `📘 最高原則`
- Drag TASK cards between process workspaces
- Highest-principle cards do not participate in TASK status dragging
- Add a new process workspace

## Board model
固定區 | 可移動、可新增區
📘 最高原則 | 待辦 → 推進 → 驗證 → 完成

## Notes
This is an interactive prototype only. Actions are simulated locally and are not connected to Supabase.
Related PM validation task: TASK-025.

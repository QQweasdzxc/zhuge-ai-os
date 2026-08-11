# Shared Navigation — Desktop Hamburger QA

## Scope

This UI-only correction is implemented in the canonical Shared Shell. It does
not change Dashboard, WorkLog, Investment, data, authentication, or business
logic.

## Root Cause

The shared header intentionally exposed `zhuge-shared-menu` when the desktop
sidebar was collapsed, while legacy WorkLog selectors could also expose the
sidebar `sidebar-menu-mark`. That created two desktop navigation controllers:
the hamburger and the circular collapse/expand control.

## Rule

- Wide desktop (`min-width: 1181px`): hamburger controls are hidden; the
  circular Shared Navigation collapse/expand control remains available in both
  expanded and collapsed rail states.
- Tablet (`768px–1180px`) and mobile (`<768px`): the existing responsive menu
  trigger remains available where the rail is not persistently usable.

## Evidence

- Canonical CSS rule: `shared/theme/zhuge-navigation.css`
- Shared header breakpoint rule: `shared/theme/zhuge-shell.css`
- Automated regression: `74 passed, 0 failed, 0 skipped`
- JavaScript syntax checks: PASS
- `git diff --check`: PASS

Candidate build and package timestamp: `20260811-2311`.

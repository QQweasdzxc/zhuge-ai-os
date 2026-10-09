# Multica Lab — Zhuge House Rules Audit

Audit goal: keep the Multica product experience as complete as practical while removing anything that makes the Zhuge Lab behave like a second SaaS tenant or bypass Zhuge authority.

## Adjusted before PM play-test

| Area | Upstream behavior | Zhuge Lab behavior |
| --- | --- | --- |
| Human login | Multica email OTP / Google login | Disabled. Zhuge is the only Human Identity Authority. |
| Human UUID | Multica creates its own user id | Reuse the current Zhuge / Supabase user UUID as Multica `user.id`. |
| Landing page | Free trial, desktop download, sales CTAs | Replaced with a Zhuge Lab boundary page. |
| Workspace creation | User can create more workspaces | Disabled server-side with `DISABLE_WORKSPACE_CREATION=true`. |
| Workspace leave/delete | Owner can leave/delete | Hidden in UI and rejected server-side. |
| Human invitations | Invite by email / accept invitation | Hidden or disabled; create/accept paths reject writes. |
| Share-link membership | Public link can join workspace | Create/join paths reject writes. |
| Human profile | Name/avatar editable in Multica | Canonical name/avatar are read-only; Zhuge owns them. |
| Logout | Logs into/out of Multica as a separate product | Becomes “返回 Zhuge AI OS”; clears the Lab-local session only. |
| Community / sales UX | Discord, feedback, Contact Sales, desktop promo | Removed from normal Lab navigation. |
| Help | Multica SaaS-oriented help menu | Keeps upstream docs/changelog, explicitly labeled upstream. |
| Billing / Cloud | Managed-cloud surfaces when enabled | Billing flags and Multica Cloud remain off. |
| Telemetry | Product analytics available | Disabled for the Lab. |
| Database | Normal Multica database namespace | Supabase `lab_multica` only; runtime search path restricted to `lab_multica, extensions`. |
| Canonical row UUID | Multica allocator | Zhuge Lab UUID authority override, preserving UUIDv7 semantics. |
| Runtime | Cloud/local options | Zhuge-owned runtime; first target is Mac mini + Codex. |

## Intentionally preserved as native Multica

- Issues / Board
- Agents
- Runs and execution history
- Runtime discovery and coordination
- Comments and mentions
- Projects
- Squads
- Skills
- Blocked / Retry behavior
- Usage / execution visibility
- Autopilot
- MCP / runtime profiles where locally configured
- Upstream documentation links for evaluation

## Important implementation rule

The overlay is not allowed to silently drift with upstream.

Build-time patch scripts require exact markers from the pinned Multica commit. If the upstream layout or route contract changes, the Lab build fails instead of quietly re-enabling a forbidden human-auth or workspace-membership path.

## Known non-blocking upstream characteristic

Multica currently ships a Simplified Chinese web bundle rather than a dedicated Traditional Chinese bundle. Zhuge-owned boundary pages use Traditional Chinese. A full Traditional Chinese localization is a separate localization layer and is not allowed to alter the Agent/Run/Runtime experiment semantics.

## First-play target

The PM should experience:

Zhuge identity → Multica Lab → connect Zhuge runtime → create/assign issue → Agent run → progress → completion / blocker → retry / handoff.

No Multica signup, no second human account, no second workspace authority.

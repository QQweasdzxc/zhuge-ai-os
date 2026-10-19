# Pixel Office P2 — Issue #70 Role Authority Candidate

## Candidate identity

- Issue: [#70](https://github.com/QQweasdzxc/zhuge-ai-os/issues/70)
- Base: `main` at `a9db9b2fe3051e22d59e52ad083c8d54d12dba62` (`0.9.0-alpha.9.76` / Build `20261018-1932`)
- Candidate: `0.9.0-alpha.9.79` / Build `20261019-1434`
- Branch: `review/p2-issue-70-role-authority-20261019`
- Commit / Draft PR: use this document's hosting commit and the GitHub Draft PR metadata as the exact references; no mutable SHA is embedded in the source itself
- Pinned Habblaud: `faa1a012b5fbf632c66dc6801c5383e53a542406` (MIT; source remains unchanged)
- Production/main: unchanged; candidate only

## Authority and scene behavior

- Permanent cast is Jackal (PM), GPT, Codex and Gem, with stable IDs. The fixed cast is explicitly a pixel-role roster, not a location, provider account, CLI session or proof of work; every fixed character remains idle.
- `active_modules`, `blocked_items`, `next_actions` and `recent_prs` remain read-only project snapshot information. They no longer create scene rooms, people, subagents, lights or working statuses. A dedicated HUD panel displays this material with snapshot time/freshness and safe HTTPS GitHub PR links.
- Live Habblaud agents are admitted only while the same-origin SSE is open and a fresh (`serverTime` within 60 seconds), non-demo snapshot has a matching healthy source, active account and distinguishable main-agent/session identity. Subagents, demo IDs, offline or mismatched identities are excluded. Source filesystem paths, account email/organization and config directories are removed from the snapshot sent to the scene.
- The snapshot panel uses DOM text nodes; external links use `noopener noreferrer`.

## QA evidence

| Check | Result |
|---|---|
| Pixel-office contracts, furnishings and P2 tests | PASS, 13/13 |
| Bridge provenance fixtures: closed SSE, demo, stale, mismatched source/account, subagent, accepted verified main agent | PASS |
| Fresh pinned-upstream overlay build | PASS, output `/tmp/p2-issue70-finalpages-20261019`; upstream SHA verified by build script |
| Pinned Habblaud client TypeScript check | PASS (`tsc --noEmit -p tsconfig.json`) |
| Browser smoke with actual Habblaud Canvas | PASS, desktop 1280×780 and mobile Chromium 390×844; P1 routes/medal links and classic/docs entry retained |
| iPhone Safari / production Habblaud runtime | NOT RUN; not claimed |
| Formal TaskFlow event feed / live human or AI work status | NOT VERIFIED; no authenticated production event source was activated |

The browser test used the environment's system Chromium because Playwright's browser CDN returned HTTP 403. This is an isolated QA browser result, not iPhone Safari acceptance. Screenshots were captured under `/tmp/p2-issue70-screenshots-final` and should be attached from the exact candidate CI run after it is published.

## Scope and rollback

Changes are limited to the P2 bridge/HUD, bridge/browser evidence, the pixel review workflow trigger for this review branch, integration notes and synchronized formal Version/Build projections. No database, Render, Auth, Secrets, Cron, Frozen Vendor or Native Lab changes were made. Rollback is a forward-only revert of this candidate commit on its review branch; no production rollback is needed because it is not deployed.

## Remaining gate

This candidate removes fabricated people/statuses but does not establish a trusted TaskFlow or authenticated Habblaud runtime feed. Real-time work attribution stays unavailable until a separately authorized source integration supplies verifiable events. Production P2 remains unchanged.

# Canonical Source Inventory — 2026-10-01

## Scope and authority

This inventory is local-only. GitHub remote is read-only; no push, PR, merge, deploy, release, tag, Cloud mutation, Product Data mutation, or Secret operation was performed.

The three reconciliation inputs are:

1. Known-good source identity `20260929-1358`, Git commit `b9e64f4a829a62878acf60a7f2c492e7253842a2`; its tracked tree has 2,391 files and `version.json` identifies build `20260929-1358`.
2. Canonical checkout `/Users/qq/Documents/GitHub/zhuge-ai-os`, currently clean on `main` at `6553f21e1daeb97f76795066505f23cf7137b0e9` (`del`), equal to its recorded `origin/main`.
3. Local history and cleanup candidate, based on `248b1f78e043886976e135681ed9d8f149eb078b` on `codex/canonical-source-cleanup-20261001`.

The known-good FullSource ZIP/manifest was not available in its former temporary path and could not be independently retrieved from the Drive listing during this pass. Therefore the comparison is source-commit/tree-level, not a claim that ZIP bytes were reverified. The exact known-good Git commit is present locally.

The `del` commit is not accepted as the canonical source baseline: its parent is `7c49182f4f260bd87edc94362378a25859a1df2a`; the parent-to-`del` diff removes 2,395 files with no replacement files. No reset, revert, or history rewrite was performed. The working candidate uses the known-good local lineage and does not change `main`.

## Root inventory before this cleanup

Classification uses `PRODUCTION`, `LAB`, `DUPLICATE`, `ARCHIVE`, `GENERATED_ARTIFACT`, and `UNKNOWN`. Production includes canonical product source and governance/test source required to maintain it; it does not mean every file is sent to the browser.

| Root path | Classification | Decision / evidence |
|---|---|---|
| `.github/` | PRODUCTION | Retain CI/governance workflows; the manual Fubon proof workflow was Lab-only and is relocated with its adapter. |
| `.gitignore` | PRODUCTION | Retain repository boundary rules. |
| `.nojekyll` | PRODUCTION | Retain static-hosting marker. |
| `AGENTS.md` | PRODUCTION | Retain repository operating authority. |
| `README.md` | PRODUCTION | Retain canonical repository entry documentation. |
| `app/` | PRODUCTION | Canonical application routes and Board surfaces. |
| `assets/` | PRODUCTION | Shared product assets. |
| `backlog/` | PRODUCTION | Canonical local task/governance source; cleanup task recorded via Backlog CLI. |
| `config/` | PRODUCTION | Runtime and product configuration. |
| `contact/` | PRODUCTION | Canonical contact page; duplicate comparison below. |
| `docs/` | PRODUCTION | Current product/governance/QA documentation; explicit archive subtrees are ARCHIVE. |
| `google-data/` | PRODUCTION | Canonical Google verification/data page; duplicate comparison below. |
| `googlea760c88b64a73d97.html` | PRODUCTION | Site verification artifact required at hosted root. |
| `index.html` | PRODUCTION | Root application/landing entry. |
| `labs/` | PRODUCTION | Registry and boundary documentation only; no Lab application source is bundled here. |
| `modules/` | PRODUCTION | Canonical modules, including `investment/`, `skyeye/`, and `labs/`. |
| `package-lock.json` | PRODUCTION | Locked browser QA dependencies. |
| `package.json` | PRODUCTION | QA scripts and dependency contract. |
| `privacy/` | PRODUCTION | Public legal surface. |
| `product/` | PRODUCTION | Product source and policy. |
| `public/` | PRODUCTION | Public product assets/content. |
| `scopes/` | PRODUCTION | Canonical access/scope configuration. |
| `shared/` | PRODUCTION | Shared runtime, shell, and component authority. |
| `skyeye-next/` | LAB | Standalone Jimmy/God's Eye candidate; moved after no import/runtime caller was found. It was statically addressable in a full static-site tree; a future Pages deployment of this cleanup would retire that experimental URL. It is not canonical SkyEye (`modules/skyeye/`). |
| `supabase/` | PRODUCTION | Canonical Edge Functions and migrations, including production SkyEye read adapter. |
| `support/` | PRODUCTION | Canonical support content. |
| `terms/` | PRODUCTION | Public legal surface. |
| `tests/` | PRODUCTION | Canonical test source and fixtures; generated evidence subtrees are not runtime assets. |
| `tools/` | PRODUCTION | Retain canonical governance/release/runtime tools; Fubon adapter was Lab-only. |
| `version.json` | PRODUCTION | Build/version identity source; unchanged. |
| `tools/fubon-readonly-adapter/` | LAB | Isolated read-only SDK proof and vendored package; relocated outside AIOS. |
| `.github/workflows/fubon-readonly-proof.yml` | LAB | Manual proof workflow coupled only to Fubon adapter; relocated with it. |
| `contact 2/` | DUPLICATE | Absent from candidate root; `index.html` Git blob matched canonical. Removed in earlier local Repo Hygiene work. |
| `google-data 2/` | DUPLICATE | Absent from candidate root; `index.html` Git blob matched canonical. Removed in earlier local Repo Hygiene work. |
| `tools 2/` | ARCHIVE | Absent from candidate root; nine unique legacy scripts moved outside repo and Git-blob verified. |

## Baseline comparison

| Evidence | Result |
|---|---|
| Known-good 1358 Git source | `b9e64f4a829a62878acf60a7f2c492e7253842a2`, 2,391 tracked files. |
| Immediate later source lineage | `7c49182f4f260bd87edc94362378a25859a1df2a`, 2,400 files; delta from 1358 is nine `tools 2/` files. |
| GitHub `main` as read locally | `6553f21e1daeb97f76795066505f23cf7137b0e9`, message `del`, equal to `origin/main`; not accepted as the clean source baseline. |
| Current official checkout | Clean `main`; unchanged. |
| Cleanup worktree starting point | `248b1f78e043886976e135681ed9d8f149eb078b`; local branch only. |

## Unknowns kept intact

- No unknown root directory was deleted or moved.
- The separate Gloomberb Taiwan spike has runtime configuration/cache and dependency state; it remains outside AIOS and is not consolidated.
- The Lab Center currently has a Genspark-specific launch recipe. SkyEye and Fubon are separated but not advertised as runnable entries because a generic, truthful launcher contract is absent.
- External Genspark snapshots are preserved unchanged; observed SHA and mismatch with an older requested freeze SHA are recorded in `LAB_SEPARATION_MAP.md`.

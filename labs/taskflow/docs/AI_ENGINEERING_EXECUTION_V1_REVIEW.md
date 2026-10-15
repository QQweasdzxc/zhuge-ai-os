# TaskFlow AI 工程執行 v1 — isolated Review source (.9.52 / 20261015-2229)

## Source identity and reconstruction boundary

PM authorized the shared TaskFlow AI execution v1 on 2026-10-15, only on the
isolated Review branch `review/taskflow-ai-execution-v1-20261015`.
The official Codex GitHub bot previously reported a **cloud-container-local**
commit `f9963d7121fadf55fbb6dec90752c8d0362c9913`. An authenticated GitHub
GET for that exact commit returned 404. The previous policy-only `a3b1714`
also returned 404. No Codex Cloud API or working-tree download is connected to
this Review session. **This Source is a fresh, auditable implementation of the
PM-approved behavior, NOT the unavailable Codex commit and not a recovered patch.**
Do not present GitHub blob URLs from the old `.9.51` checkout as the missing
Codex UI code.

## Boundaries

- TaskFlow native Issue is SSOT, human assignee remains authoritative.
- Project has default-OFF "啟用 AI 工程師" preview option. The preview value is
  stored in in-memory JS only; it disappears on refresh and is **not** a server
  preference. Only workspace owner/admin may change this preview.
- If project preview is OFF, native issue detail is unchanged. If project
  preview is ON, each issue has an independent opt-in, default OFF; Co is the
  default, Gem can be manually selected. Neither selection invokes a provider.
- The issue pane is separate from human Assignee and placed after native
  Wakeups / PluginPanel and before native Pull Requests; its disclosure is
  collapsed by default. Existing Wakeups, PR section and execution log remain.
- There is **no** TaskFlow native Run persistence, service identity, GitHub API
  write, Codex/Gemini trigger, quota API, dispatch worker, secret, background
  process or cost. The "確認並派工" control is always disabled. Unknown quota,
  unknown GitHub SHA/CI, missing Run status and lack of PM approval are explicit.
- `evaluateAIExecution` is a pure, strict prerequisite checker, whose best
  outcome is `DISPATCH_PENDING`, never a claim that Provider has started.
- No migration, no TaskFlow Production issue ZG-6 modification, no main merge,
  no auto fallback, no vendor content modification.
- Existing `third_party/multica` must remain frozen; build patches copied
  sources only. The overlay refuses to apply when upstream source markers move.
- The two preview toggles are **not ready for customer use** until project/card
  preferences are persisted by an authenticated native TaskFlow API, and the
  authorized PM/Run control plane is separately verified.

## Acceptance and remaining gates

1. Source tests: overlay copy-only/no vendor mutation, fail-closed on changed
   upstream marker, preserved Wakeups/PR, default Co, dual opt-in, manual Gem,
   denied PM/actor/workspace/Run/Backend/quota/SHA/writer/CAS.
2. Native web image: apply overlay during existing Docker build, then run
   `@multica/views` Vitest and web build to verify typed imports/markup.
3. Browser QA: Desktop and Mobile actual native TaskFlow panel, Project settings,
   opt-in and accessibility; generic landing-page browser PASS alone **does not
   verify native TF UI**.
4. Release governance: use a new root version / Build tuple, candidate provenance
   and ensure full source, origin/main and generated Review FullSource ZIP can be
   verified before any CTO Review PASS / PM Release GO.
5. Later live integration (not part of this Review): TF workspace/project/member
   permission API, server-only identity, Run/Dispatch event persistence and
   official provider ACK, cost bounds, exact SHA and stopped-writer evidence.
6. v1.1 evidence-based "誰有空" recommendation and v2 safe auto failover are
   *deferred*; no release authorization was granted for those capabilities.

The branch's git commit and CI URLs, not a past text-only bot summary, will
be the verifiable Review evidence. Stay Draft and Production HOLD.

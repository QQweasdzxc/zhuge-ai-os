# Release Standard

## Release identity

Every formal delivery has one synchronized tuple:

```text
Version + Build + Git Commit + Package Time
```

The Build identifies the formal release, not only a runtime compile. A public
page-only change still receives a new Build.

## Production redeployment Version rule

Every Production upload or deployment, including a hotfix, re-upload or
redeployment of unchanged Source, MUST use a new Product Version and a new
Asia/Taipei Build ID. Reusing the previous Production Version is prohibited.
This rule also applies to every main Push because main triggers Pages Auto Deploy.
Unchanged-source artifact-only operations do not deploy and remain exempt.

Product Version / Build synchronization is not a C Mother publication. Preserve
Published C snapshot, adoption records and published identity; update only the
Development projection where the existing release-consistency contract requires it.
Production migration and business data mutation remain separate PM gates.

## MATERIAL SOURCE CHANGE RULE

Any completed material Source change set that is ready for delivery, backup,
review acceptance, Candidate creation, or PM handoff MUST enter a new Formal
Build Cycle.

```text
Material Source Change
→ New BUILD_ID
→ synchronized Source identity
→ QA
→ new FullSource ZIP
```

A previous BUILD_ID may be reused only when Source content is unchanged and
the operation is artifact-only (rename / relocate / re-verify existing artifact).
有實質 Source 更動，就必須建立新的 Build 與新的 FullSource ZIP；這也適用
Review／QA Backup，不能藉 Artifact Type 避開 Formal Build Cycle。

The existing release-governance.js automatically reads the fetched origin/main
commit and its version.json as the previous formal Source/Build baseline. It
compares eligible tracked Git blobs, paths and modes, including governance,
docs, tests and migrations. Source delta + unchanged formal Build produces
BUILD_IDENTITY_STALE: FAIL before preflight/packaging for every artifact type.
Missing/diverged formal baseline also fails closed. There is no override or
second baseline registry. Excluded runtime/cache artifacts are not formal Source.
The gate and baseline SHA are recorded and reverified in the Manifest against
Git history. Main promotion may advance the live baseline; immutable cut-time
evidence remains valid without rewriting prior ZIPs or Manifests.

Use the existing tool's new-build-id generator at Formal Build start, then
sync-build --build <approved-new-build> to update root Source identity and its
existing projections. Synchronization preserves Published C evidence and its
loader identity. It does not create a commit, deploy or write Cloud.

## Formal Build Cycle

At the start of every new Formal Build Cycle, obtain the current date/time in
`Asia/Taipei` and generate a new `BUILD_ID` in `YYYYMMDD-HHmm` format. It must
not equal the previous Formal Build's `BUILD_ID`. Write the new value to the
root `version.json.build`, then synchronize every Runtime, Module, UI,
cache-buster, Manifest, and Candidate identity before committing.

`version.json.build` remains the single Build Identity source. `artifactCreatedAt`
is captured when the ZIP/artifact has actually been created and is retained as
full-precision `Asia/Taipei` provenance metadata only.

The formal sequence is:

```text
Start Formal Build
→ Asia/Taipei current YYYYMMDD-HHmm
→ generate NEW BUILD_ID
→ update Source Build Identity
→ Commit
→ Working Tree clean
→ Pre-Gate
→ Regression / Preflight
→ Package
→ Post-Gate
→ Manifest / ZIP Verification
```

## Release gate

- `git diff` contains only intended files.
- `git status` is clean after commit.
- Formal packaging fails closed when the Git Working Tree is not clean.
- Root Landing / Dashboard is publicly readable.
- `?app=1` and OAuth callback remain functional.
- WorkLog, Sidebar, and Session regressions are absent.
- Source and UAT packages use the same Version and Build.
- `version.json`, UI metadata, Release Notes, and Git commit agree.

## Published versus Development identity

The current Candidate / Runtime and the Published C Runtime are separate
identity layers. Candidate Build Identity comes from the root `version.json`
and current Runtime metadata. The Published C Runtime is the Cloud record
returned by `get_published_module_release('c')`, whose canonical fields are:

- `published_version`
- `published_build`
- `source_commit`
- `source_fingerprint`

Published fields are immutable release evidence; Candidate Build or current
Development HEAD must never substitute for them. A new FullSource Candidate
may therefore use a new Build while the Published C Snapshot and existing
Consumer Adoption continue to identify the previous Published Build. This is a
valid `DEVELOPMENT_AHEAD` / `NOT YET PUBLISHED` state, not an identity mismatch.

Consumer Adoption is a separate acknowledgement. `publish_module_release`
seeds Published source identity and `record_module_adoption` derives
`source_commit` / `source_fingerprint` server-side from the locked Published
Release. Adoption cannot choose Development identity. Version/Build alone is
not complete Source Identity.

Existing adoption records from before source fields are not silently backfilled.
If exact Version/Build resolves to a complete Published Release, Runtime may
expose read-only `RESOLVED_FROM_PUBLISHED_RELEASE`; the record remains
explicitly legacy/non-persisted evidence until a governed adoption write.

## Candidate packaging governance

The root `version.json.build` is the only Candidate `BUILD_ID` and Candidate
filename identity source. Runtime configuration, Module manifests, Runtime UI
identity, and ordinary Runtime asset cache-busters must match it exactly. The
`template-release.js` Development version/build projection must also match the
Candidate root identity. The loader URL for
`shared/config/template-release.js` is the deliberate exception: its `?v=`
cache-buster must match the Published C Build, not the new Candidate Build. The
Published Snapshot and each Adoption record must remain
internally consistent with the verified Published identity, independently of
the Candidate Build. Arbitrary dates in CSS comments or documentation are not
Build Identity fields.

The Candidate Manifest records both identities: Candidate `build` plus the
separate Published C identity (`version`, `build`, `sourceCommit`,
`sourceFingerprint`, `publishedAt`, and Consumer Adoption evidence). Candidate
packaging validates both contracts without performing or implying a Publish.
`template-publish.js --check` is Publish Readiness only; it is not a Candidate
Packaging gate and may correctly report not-ready while the Candidate is ahead
of Published C. It performs no Publish write.

Candidate filenames use `version.json.build`, formatted as `YYYYMMDD-HHmm`.
`artifactCreatedAt` is separate artifact metadata and must not participate in
the Candidate filename prefix.

Use the controlled tool path for Candidate packaging:

```bash
node tools/release-governance.js preflight
node tools/release-governance.js package \
  --description Checklist-Canonical-Final \
  --regression-json '{"governance":"PASS","checklist":"PASS","full":"PASS","gitDiffCheck":"PASS","browser":"PASS"}' \
  --output-dir dist
```

The existing tool supports Candidate, Review and QA Backup through one packager.
Every FullSource filename is:

```text
YYYYMMDD-HHMM_Zhuge_AI_OS-v<Version>-<Scope>-FullSource-<Candidate|Review|QA-Backup>.zip
```

Candidate prefix = version.json.build = Runtime Build = Manifest candidateBuild.
Review / QA Backup prefix = actual Artifact Created At in Asia/Taipei, independent
of the current source Build. Review / QA Backup do not bypass the Material
Source Change rule: completed changed Source first needs a new synchronized
Build and QA. Only unchanged-source artifact-only operations may reuse Build.
All artifacts retain source build and full Git SHA / Parent SHA; only Candidate
has candidateBuild. Sidecars use the complete ZIP basename:
`.zip.manifest.json` and `.zip.sha256`.

Scope must be descriptive ASCII letters/numbers/hyphens. Any TASK number requires
readback through the existing protected engineering-transition inspect path:
a real task UUID, exact work_code and formal Board UUID, visible to PM. No local
Backlog, guessed ID or caller-supplied boolean can authorize a TASK filename.
If protected readback is unavailable, use a descriptive scope. The packager
records sanitized TASK identity provenance, never credentials or actor tokens.

```bash
node tools/release-governance.js package --type review \
  --description Global-Header-Workspace-Count-Archive-Fix \
  --regression-json '{"governance":"PASS","checklist":"PASS","full":"PASS","gitDiffCheck":"PASS","browser":"PASS"}' \
  --output-dir /workspace/artifacts/Global-Header-Workspace-Count-Archive-Fix
```

Use `--type qa-backup` for QA Backup and `--type candidate` (default) for a
formal Candidate. PASS inputs must come from actual QA of the packaged source;
baseline failures, skipped/browser-unavailable/auth-unavailable checks are not
PASS. Report PASS, FAIL, BLOCKED, NOT VERIFIED or PENDING accurately. The tool
requires browser regression evidence as well as the existing release gates.

Packaging uses the clean commit's tracked eligible blobs, excludes .git,
node_modules, caches/temp/profile/runtime scratch fixtures and secrets, and
verifies Source-to-ZIP hashes, ZIP integrity, Manifest naming/identity, SHA256
sidecar and file count. Excluded tracked scratch files are recorded explicitly
in the Manifest; no untracked/ignored runtime artifacts may enter FullSource.
Every destination is append-only; never overwrite an existing artifact set.

Artifact destination may be a Cloud workspace directory, Mac local/Google Drive
or another PM-designated location. Use `--output-dir`; optional `--deliver`
requires an explicit `--delivery-root`. Delivery path is not version-control
Authority. Artifact Identity + Manifest + SHA256 + Git SHA define the archive;
GitHub main remains Source SSOT. Do not add a storage registry.

## Source, promotion and runtime gates

Existing Capability First: request → EXISTS / PARTIAL / MISSING → authorized
smallest gap only. One capability has one shared canonical authority.
Before work: git fetch origin, verify task BASE_SHA = origin/main and clean tree.
Preserve already-authorized unpushed work; a mismatch is HARD STOP, never an
implicit merge, rebase, reset or permission to add unrelated commits.

Local commit → no deployment. Push main = GitHub Pages Production Auto Deploy.
The required sequence is Coding → Developer QA → local commit → Artifact →
GPT/CTO Review PASS → PM task-specific exact-SHA Push Authorization → main →
Production Auto Deploy → Runtime Readback. Immediately before authorized Push,
fetch again and require origin/main == task BASE_SHA. Push only the reviewed
exact commit with its explicitly approved fast-forward lineage. Never force push,
self-create PR/merge, inherit another task's authorization or manually deploy.

After Push verify GitHub main SHA = artifact SOURCE_SHA = Production deployed SHA
and read back Version / Build. If Production SHA cannot be read, report NOT
VERIFIED. Deploy failure: report logs/blocker and stop for GPT/PM; do not blindly
retry Push, force push, revert source or invent a source-fix commit.

A source migration file is not an applied migration. Pages does not apply
Supabase migrations, publish Workflow or mutate Production DB. Each requires
separate explicit PM/GPT authorization and the existing controlled authority.
Always report SOURCE_STATE, MIGRATION_STATE, DEPLOY_STATE and RUNTIME_STATE
separately. Developer QA does not imply QJC/PM runtime acceptance.

## Mandatory delivery self-check

Before every report check BASE_SHA_VERIFIED, EXISTING_CAPABILITY_CHECK,
TASK_ID_AUTHORITY, VERSION, BUILD, ARTIFACT_NAMING, MANIFEST, SHA256,
SOURCE_TO_ZIP, QA, FULL_REGRESSION, BROWSER_REGRESSION, MIGRATION_STATE,
PUSH_AUTHORIZATION, DEPLOY_STATE and WORKING_TREE. Inapplicable or unverified
checks must be explicitly identified; any failed required gate is HARD STOP,
never an overall release PASS.

## Foundation freeze

Core changes require an explicit architecture decision. New modules must use
the existing Shell, Shared Core, Services, AI, Theme, i18n, and release
contracts rather than creating a parallel foundation.


## ZG-71 review build — 2026-11-08

Version `0.9.0-alpha.9.190` · Build `20261108-2359` (Asia/Taipei).
Baseline main: `2ddf801287963f4909890e4ad6141202a85d24c8` (ZG-70 #246).
Per-person reversible access cards, creator-only App identity union, append-only
Off/On events and missing 11/06 pause baseline; no production SQL, merge or deploy.
Historical REJECTED remains allowed during pause until explicitly switched Off.
Full audit, policy precedence, deployment order, coverage gaps and SQL evidence:
`labs/taskflow/docs/ZG71_ACCESS_SWITCH_AUDIT.md`.

Release synchronization changes only Version/Build/cache identity in:

```text
app/Board/ai/index.html
app/Board/investment/index.html
app/Board/procurement/index.html
app/Board/template-preview/index.html
app/Board/worktodo/index.html
app/dashboard/index.html
app/dashboard/zhuge-dashboard.js
docs/index.html
docs/status-classic.html
index.html
labs/investment/app.js
labs/investment/index.html
labs/investment/src/portfolio/view.mjs
labs/investment/version.json
labs/taskflow/index.html
modules/investment/index.html
modules/investment/version.json
modules/skyeye/index.html
modules/worklog/chat/index.html
modules/worklog/index.html
modules/worklog/version.json
shared/app-config.js
shared/config/template-release.js
shared/config/version.js
status-classic.html
version.json
```

Published C identity is preserved by the existing sync-build gate. A FullSource
Review artifact is required by this policy; its QA record must retain the known
baseline failures: mobile-actions/compact-header 116.1875 and investment providers
16 PASS / 1 FAIL. Focused access tests and 84 TF Python tests pass locally; this
is not a full-regression PASS or a deployment approval. PR CI is reported separately.

ZG-71 packaging status: BLOCKED. The existing packager requires real full/browser
PASS; known baseline failures are retained, so no FullSource artifact is issued
and no PASS evidence is fabricated. Earlier whitespace CI failure in the added
SQL fixture is corrected; complete PR diff whitespace is checked.

## ZG-71 follow-up review — 2026-11-09

Version `0.9.0-alpha.9.191` · Build `20261109-0034` (Asia/Taipei).
Same PR #247, baseline main `2ddf801287963f4909890e4ad6141202a85d24c8`.
One effective_allowed function, self-only first-entry membership, owner-only
one-time cutoff snapshot (not activated), seven caller-JWT Edge gates, live
function comparison, aggregate impact, tested rollback and committed TEST DATA
screenshots. No production writes, Edge deployment, migration application,
cutoff activation or merge. TF native sessions remain explicitly outside scope.

The 26 runtime Version/Build/cache synchronization paths are the same set listed
in the previous ZG-71 review entry. Complete current diff, including gate/UI/Edge,
SQL tests, docs and PNGs: `docs/zg71/changed-files.txt`. Published C identity stays
unchanged. Evidence: `labs/taskflow/docs/ZG71_ACCESS_SWITCH_AUDIT.md` and
`docs/zg71/live-definition-comparison.md` / `deployment.md` / `impact-counts.json`.
Baseline mobile-actions and compact-header 116.1875 and investment provider
16 PASS / 1 FAIL remain reproducible locally; no unrelated fix or fake full PASS.
FullSource packaging remains BLOCKED by the existing actual-full-PASS gate.

## ZG-71 review supplement 7 — 2026-11-09

Version `0.9.0-alpha.9.192` · Build `20261109-0104` (Asia/Taipei).
Same PR #247, main baseline `2ddf801287963f4909890e4ad6141202a85d24c8`.
Read-only audit found zero matches in 164 App/TF/private identity/activity fields
for the one unproven identity; Google sign-in 1–7 days ago and 3 unrevoked refresh
tokens mean it cannot be labelled inactive/test. The fixed activation proposal
excludes it: migration alone keeps 6 allowed; explicit owner activation(1) would
make 5 allowed / 1 Off. Count drift aborts; no Auth roster import or forced login.
Nothing has been activated, written to production, deployed or merged.

Top-level UI now contains only cards/effective switches/pending labels. Existing
pause control is below the cards in collapsed advanced transition settings;
backend pause behavior is unchanged. Native DPR2 mobile PNG is 780x3566, no
resizing. TF login's existing Supabase HTTP helper can support a future login-only
check; native refresh/session credentials remain distinct. No TF auth change.

Live seven-function comparison rechecked unchanged; SQL/rollback/48-case UI,
Edge and TF tests rerun. Full diff list: docs/zg71/changed-files.txt. All 26
existing release sync files are synchronized; Published C identity stays fixed.
Known three local baseline failures remain, so FullSource package still cannot
claim full PASS. Final same-head CI is recorded in PR independently.

## ZG-71 frozen-cohort activation — 2026-11-09

Version `0.9.0-alpha.9.194` · Build `20261109-0600` (Asia/Taipei).
Same PR #247, main baseline `2ddf801287963f4909890e4ad6141202a85d24c8` (Version
.189). `.190`-`.192` were earlier review builds of this PR; `.193` is already used by
the draft review/p0-functional-consolidation-20261023 branch, so this review uses `.194`.
The activation RPC `private.activate_app_access_model(expected_allowed)` now locks the
decision-event and settings tables, takes the cutoff after the locks, freezes the set of
currently effective allowed identities in one read, aborts when the count differs, and
returns counts only. The previous cutoff would have turned one allowed account Off.
Verified: live seven-function md5 match and 6 allowed / 0 blocked (read-only), two-connection
PostgreSQL concurrency run on an isolated synthetic server, SQL/UI/Edge/rollback tests, and
PR CI. Not tested: a writer that starts before activation and commits after it began,
and TF existing sessions (not covered by the App switch). No production write, migration,
Edge deploy, activation or merge. Release synchronization changes only Version/Build/cache
identity in the same 26 paths listed above, plus the Version-only paths of this entry.
FullSource packaging remains BLOCKED by the existing full-PASS gate (baseline failures:
mobile-actions/compact-header 116.1875, investment providers 16 PASS / 1 FAIL).

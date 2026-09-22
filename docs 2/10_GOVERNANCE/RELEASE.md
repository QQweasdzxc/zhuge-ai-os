# Release Standard

## Release identity

Every formal delivery has one synchronized tuple:

```text
Version + Build + Git Commit + Package Time
```

The Build identifies the formal release, not only a runtime compile. A public
page-only change still receives a new Build.

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
  --regression-json '{"governance":"PASS","checklist":"PASS","full":"PASS","gitDiffCheck":"PASS"}' \
  --output-dir dist \
  --deliver
```

The tool creates a temporary ZIP under `dist/`, derives its filename from the
root `version.json.build`, records `artifactCreatedAt` as separate manifest
metadata, runs the Post-Packaging Gate from the ZIP itself, and only then
copies the ZIP and Manifest to the formal PM delivery directory:

```text
/Users/qq/Library/CloudStorage/GoogleDrive-qq.1025@gmail.com/我的雲端硬碟/TOOLS-自製/ZhuGe AI OS/版控/
```

The formal delivery is append-only: existing artifacts are never overwritten.
The Post-Packaging Gate validates ZIP identity, Source ↔ ZIP file hashes,
`unzip -t`, SHA-256, file count, and Candidate Manifest identity.

## Foundation freeze

Core changes require an explicit architecture decision. New modules must use
the existing Shell, Shared Core, Services, AI, Theme, i18n, and release
contracts rather than creating a parallel foundation.

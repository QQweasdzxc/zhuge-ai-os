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

The current Source and the Published C Runtime are different identity layers.
The Source Build Identity comes from the root `version.json` and current
Source/runtime metadata. The Published C Runtime is the Cloud record returned
by `get_published_module_release('c')`, whose canonical fields are:

- `published_version`
- `published_build`
- `source_commit`
- `source_fingerprint`

Published fields are immutable release evidence; the current Development HEAD
must never substitute for them. Development may be `DEVELOPMENT_AHEAD` /
`NOT YET PUBLISHED` while Runtime identifies a previous Published C snapshot.

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

The root `version.json.build` is the only `BUILD_ID` and Candidate filename
identity source. Runtime configuration, module manifests, Runtime UI identity,
and literal HTML/JS/CSS cache-busters must match it exactly. Candidate
filenames use that `BUILD_ID`, formatted as `YYYYMMDD-HHmm`. `artifactCreatedAt`
is separate artifact metadata and must not participate in the Candidate
filename prefix.

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

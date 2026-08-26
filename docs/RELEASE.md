# Release Standard

## Release identity

Every formal delivery has one synchronized tuple:

```text
Version + Build + Git Commit + Package Time
```

The Build identifies the formal release, not only a runtime compile. A public
page-only change still receives a new Build.

## Release gate

- `git diff` contains only intended files.
- `git status` is clean after commit.
- Root Landing / Dashboard is publicly readable.
- `?app=1` and OAuth callback remain functional.
- WorkLog, Sidebar, and Session regressions are absent.
- Source and UAT packages use the same Version and Build.
- `version.json`, UI metadata, Release Notes, and Git commit agree.

## Candidate packaging governance

The root `version.json.build` is the only Candidate Build Identity source.
Runtime configuration, module manifests, Runtime UI identity, and literal
HTML/JS/CSS cache-busters must match it exactly. Package time is metadata only;
it must never be used as the Build Identity or ZIP filename prefix.

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
root Build Identity, creates a sidecar Candidate Manifest, runs the
Post-Packaging Gate from the ZIP itself, and only then copies the ZIP and
Manifest to the formal PM delivery directory:

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

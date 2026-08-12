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

## Foundation freeze

Core changes require an explicit architecture decision. New modules must use
the existing Shell, Shared Core, Services, AI, Theme, i18n, and release
contracts rather than creating a parallel foundation.

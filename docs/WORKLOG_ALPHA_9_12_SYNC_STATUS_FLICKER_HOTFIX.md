# WorkLog Alpha 9.12 Sync Status Flicker Hotfix

- Version: `0.9.0-alpha.9.12`
- Build: `20260804-1515`

## Root cause

`refreshCloudSyncStatusDisplay()` replaced `developerCloudSyncStatus.innerHTML` every time any background sync status refresh occurred, even when the visible value was unchanged. This removed and re-added three child nodes repeatedly, triggering continuous sidebar repaint and visible full-page flicker on macOS browsers.

## Fix

The renderer now preserves the existing `<strong>`, `<span>`, and `<time>` nodes and changes `textContent` only when a displayed value differs. A one-time compatibility fallback rebuilds malformed legacy markup.

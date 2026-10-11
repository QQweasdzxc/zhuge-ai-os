# TaskFlow Traditional Chinese (Taiwan) locale overlay

## Locale contract

TaskFlow keeps exactly five selectable locales:

| Menu label | Internal locale | HTML `lang` |
| --- | --- | --- |
| English | `en` | `en` |
| 繁體中文（台灣） | `zh-Hant` | `zh-TW` |
| 简体中文（中国） | `zh-Hans` | `zh-CN` |
| 日本語 | `ja` | `ja-JP` |
| Français | `fr` | `fr-FR` |

The TaskFlow build overlay replaces the frozen Multica `ko` locale with
`zh-Hant`; it does not change files under `third_party/multica/`.

## Preference compatibility

- Locale matching keeps `zh-TW`, `zh-Hant`, `zh-Hant-TW`, `zh-HK`, and
  `zh-MO` on `zh-Hant`; `zh-CN`, `zh-Hans`, `zh-Hans-CN`, `zh-SG`, and the
  legacy bare `zh` resolve to `zh-Hans`.
- An explicit `multica-locale` cookie wins over browser `Accept-Language`.
  Unsupported legacy `ko` resolves through the normal default (`en`) rather
  than being replaced by a different browser preference.
- On authenticated load, `user.language` is normalized for the runtime:
  legacy `zh` / `zh-CN` resolve to `zh-Hans`, `zh-TW` resolves to `zh-Hant`,
  existing supported values remain unchanged, and legacy `ko` falls back to
  `en`. This is read-time compatibility only; no account rows are rewritten.
- `PATCH /api/me` accepts the five canonical values and rejects `ko`. The
  existing language column is text, so this overlay needs no schema migration.
- The existing cookie → account preference write path and `UserLocaleSync`
  remain in place. The sync writes a cookie and reloads only when the resolved
  account preference differs from the active locale, preventing a reload loop.

## Translation resources

The overlay supplies the same 25 namespaces as the English locale. English is
the canonical source for namespace/key and interpolation parity checks. The
Traditional Chinese text was adapted from the existing Simplified Chinese
locale as a draft, then converted and normalized with a Taiwan terminology
pass (for example `專案`, `任務`, `工作區`, `負責人`, `到期日`, `看板`, `清單`,
`表格`, `時間軸`, `泳道`, `搜尋`, and `篩選`). It is not presented as a
line-by-line human translation from English; the candidate QA checks structural
parity, while final editorial review remains part of GPT/CTO review.

Settings, shared actions, projects, tasks, the five native views, agents,
dialogs, toasts, error states, and empty states use the 25 registered bundles.
There are also 100 localized celestial workspace names. Landing use-case
articles, public documentation routes, and the onboarding prompt pack do not
have a Taiwan-Traditional source in the frozen snapshot; those specific
surfaces fall back to English rather than displaying Simplified Chinese.

## Build and verification boundary

`apply-taskflow-zh-hant.py` applies the replacement only to the temporary
TaskFlow build source. The web wrapper validates locale resource parity before
patching; the backend wrapper changes only the locale allowlist and language
tests. The Frozen Vendor remains the provenance and license authority.

The candidate is isolated to TaskFlow build overlays and QA. It does not alter
the Production database, Auth, Secrets, Cron, other Apps, `main`, or a deployed
service. Production deployment remains a separate PM decision.

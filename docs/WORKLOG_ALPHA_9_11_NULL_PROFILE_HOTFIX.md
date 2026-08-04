# WorkLog Alpha 9.11 Null Work Profile Hotfix

## Release identity

- Version: `0.9.0-alpha.9.11`
- Build: `20260804-1255`
- Scope: WorkLog startup crash only

## Incident

WorkLog could remain on `Opening WorkLog…` while Supabase requests returned `200 OK`.
The browser console reported:

```text
TypeError: Cannot convert undefined or null to object
normalizeWorkProfile -> pick -> hasOwnProperty
```

The `user_work_profiles` query is allowed to return no row. The repository therefore returns
`null`, but `normalizeWorkProfile(value = {})` only applied its default for `undefined`, not for
an explicit `null`. Calling `Object.prototype.hasOwnProperty.call(null, ...)` terminated rendering.

## Fix

`normalizeWorkProfile` now normalizes non-object values, including `null`, to an empty object before
reading fields. Missing cloud work-profile data falls back to the existing local/profile seed rather
than terminating WorkLog rendering.

The WorkLog runtime cache-busting build token was also updated so Chrome and Safari fetch the patched
JavaScript instead of reusing the previous cached runtime.

## Files changed

- `modules/worklog/worklog-app.js`
- `modules/worklog/index.html`
- `tests/work-profile-null-regression.test.js`
- Release identity manifests and UI metadata

## Validation

- Regression test added for `normalizeWorkProfile(null, profile)`.
- Full Node test suite: 25 passed, 0 failed.

# Zhuge SkyEye Mobile Read Contract

`modules/skyeye/` is a mobile-only, authenticated read surface inside the
existing Shared Shell. It does not create a second map product, persist map
data, or alter Investment / Module C contracts.

## Runtime path

```text
Mobile Shared Navigation
  -> modules/skyeye/
  -> Shared Supabase Gateway (authenticated session)
  -> zhuge-skyeye-read (read-only Edge adapter)
  -> TDX / CWA / MOENV
  -> normalized evidence + source/as_of/freshness
  -> map markers / bottom detail / evidence-only summary
```

## Edge secrets

The values below are configured only in the Supabase Edge Function secret
boundary for `zhuge-skyeye-read`. They must never be committed, placed in the
browser, or included in a Candidate ZIP.

| Secret name | Source | Used for |
| --- | --- | --- |
| `TDX_CLIENT_ID` | TDX member API client registration | opt-in CCTV metadata request |
| `TDX_CLIENT_SECRET` | TDX member API client registration | opt-in CCTV OAuth token |
| `CWA_API_KEY` | CWA Open Data member API key | weather observations and earthquake reports |
| `MOENV_API_KEY` | MOENV open data API key | AQI monitoring data |

The initial map request never requests CCTV. A user action is required before
the Edge adapter calls TDX. The adapter returns sanitized provider metadata;
it does not return OAuth credentials or raw provider error bodies.

## Runtime evidence rules

Every layer carries `provider`, `source`, `source_url`, `retrieved_at`,
`as_of`, `freshness`, `stale`, `available`, and `evidence_status`. Missing
credentials or provider failure is represented as `INSUFFICIENT_EVIDENCE`.
The screen summary is derived only from layers that were loaded successfully.
No unavailable layer is replaced with a sample, cached fake, or inferred
conclusion.

## Safe injection

PM/Cloud operator must set the four names in the Supabase project Edge
Function secrets UI or the existing controlled secret-management path. The
values must not be supplied in chat, source, migration, Git, browser storage,
logs, or artifacts. No database migration is required for this read-only
adapter.

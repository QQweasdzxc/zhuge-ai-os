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

## Provider attribution, terms and licensing boundary

SkyEye keeps provider identity and the source URL on every returned layer. The
adapter is a read-through evidence normalizer; it does not persist or expose
raw provider responses, credentials, access tokens, or a second provider data
store.

| Surface | Current source boundary | Required operational treatment |
| --- | --- | --- |
| Map tiles | Leaflet 1.9.4 with OpenStreetMap tiles | Keep the visible OpenStreetMap attribution. Before production traffic, verify the current OpenStreetMap tile usage policy and capacity requirements. |
| CCTV metadata | Taiwan TDX API | Keep TDX source/as-of metadata, request CCTV only after user action, and follow the current TDX API registration, rate and redistribution terms. |
| Weather / earthquake / radar | Taiwan CWA Open Data and official radar URL | Keep CWA source/as-of/freshness evidence and verify the current CWA open-data usage terms before changing request volume or caching policy. |
| AQI | Taiwan MOENV Open Data API | Keep MOENV source/as-of/freshness evidence and verify the current API terms and rate limits before production activation. |

No third-party source code was copied into this adapter. The UI uses the
existing Leaflet distribution; its attribution is rendered by the map control.
Provider terms can change independently of this repository, so deployment
approval must include a current terms/rate-limit check rather than treating
this document as a permanent legal grant.

## Deploy-ready checklist (no deployment performed by this change)

1. Deploy only the `zhuge-skyeye-read` Edge Function from this source state.
2. Configure the four secret names above in the Supabase Edge secret boundary;
   never put their values in source, migrations, browser storage, logs, or
   candidate artifacts.
3. Keep the authenticated gateway path and `SKYEYE_ALLOWED_ORIGINS` contract;
   do not expose the provider endpoints directly to the browser.
4. Verify the sanitized response has `read_only: true`, provider/source/as-of
   metadata, `freshness`, `stale`, `data_quality`, and an explicit
   `INSUFFICIENT_EVIDENCE` or provider error code when a layer is unavailable.
5. Verify the default request does not load CCTV; a user action is required for
   that opt-in layer. Roll back by restoring the previous Edge Function source
   and its matching candidate, without changing Product Data.

## Safe injection

PM/Cloud operator must set the four names in the Supabase project Edge
Function secrets UI or the existing controlled secret-management path. The
values must not be supplied in chat, source, migration, Git, browser storage,
logs, or artifacts. No database migration is required for this read-only
adapter.

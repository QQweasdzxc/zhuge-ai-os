# Jimmy Taiwan God’s Eye Desktop Parity Matrix

Candidate scope: `codex/skyeye-jimmy-taiwan-parity-20260927`
Upstream baseline: `bilawalsidhu/gods-eye-view@b210ab0fe4d71c7faa0268134e0aa5f3c53fc7fe`
Reference runtime: <https://godeyes.jimmy-dev.win/>
Reference evidence is behavioral/network evidence only. The Jimmy same-origin `/api/*` gateway is not a production dependency.

## Status vocabulary

`NOT_STARTED` = no implementation/evidence yet; `PARTIAL` = a subset or contract exists; `FUNCTIONAL_MATCH` = the capability is usable in the candidate but visual parity is not yet closed; `VISUAL_MATCH` = visual/interaction comparison is recorded but functional proof is incomplete; `PARITY_PASS` = functional, visual, and interaction evidence all pass; `BLOCKED` = intentionally held because the provider, license, or source is unknown.

## Matrix

| Reference capability | Candidate status | Evidence / implementation boundary | Next gate |
|---|---|---|---|
| Globe / camera navigation | FUNCTIONAL_MATCH | Frozen MIT upstream Cesium app is retained as the isolated application surface. | Desktop screenshot + interaction comparison |
| NLSC EMAP basemap | PARTIAL | Official NLSC WMTS source is an opt-in `nlsc-emap` stack; local contract/probe is covered. | Live candidate tile/render proof |
| NLSC PHOTO2 basemap | PARTIAL | Official NLSC WMTS source is an opt-in `nlsc-photo2` stack; attribution is rendered by Cesium. | Live candidate tile/render proof |
| Flights / OpenSky ADS-B | FUNCTIONAL_MATCH | Upstream flight layer/provider retained; Jimmy evidence names OpenSky behind its gateway. | Candidate interaction screenshot |
| Aircraft selection | FUNCTIONAL_MATCH | Upstream selection surface retained. | Select/inspect screenshot |
| Aircraft tracking | FUNCTIONAL_MATCH | Upstream tracking/cockpit path retained; Jimmy FlightAware page is reference-only and not copied. | Tracking evidence |
| Military aircraft | UNKNOWN | No separate Taiwan runtime control or endpoint was observed; no inference is made. | Provider/source evidence |
| AIS vessels | FUNCTIONAL_MATCH | Upstream AIS capability retained; Taiwan gateway evidence names AISStream.io but its server socket is not copied. | Candidate interaction screenshot |
| Earthquakes | FUNCTIONAL_MATCH | Upstream USGS capability retained; Taiwan evidence confirms `/api/earthquakes` and USGS metadata. | Candidate evidence + attribution |
| Satellite | FUNCTIONAL_MATCH | Frozen upstream CelesTrak/satellite layer retained. | Taiwan runtime comparison |
| Taiwan satellite replacement | UNKNOWN | Not observed in the tested Jimmy UI state. | Do not guess provider |
| CCTV global/catalog | FUNCTIONAL_MATCH | Upstream CCTV architecture retained. | Candidate interaction screenshot |
| Taipei CCTV | PARTIAL | Taiwan media hosts were observed; official catalog/source and reuse terms are unresolved. | Adapter + license review |
| New Taipei CCTV | PARTIAL | HLS hosts were observed; official catalog/source and reuse terms are unresolved. | Adapter + license review |
| Freeway CCTV | PARTIAL | Multipart MJPEG host was observed; catalog/source and reuse terms are unresolved. | Adapter + license review |
| Radar | PARTIAL | CWA radar image source is recorded in the provider registry; no candidate layer wiring yet. | Provider decision + E2E |
| Wind / GFS | PARTIAL | CWA/Twipcam-labelled GFS evidence is recorded; redistribution boundary is unresolved. | Provider/terms review |
| Typhoon | PARTIAL | CWA-labelled KML evidence is recorded; redistribution boundary is unresolved. | Provider/terms review |
| AQI | PARTIAL | Taiwan station response was observed; official source/terms and adapter are not yet active. | Adapter + attribution |
| Traffic incidents | PARTIAL | Taiwan gateway evidence exists; original official endpoint/terms need confirmation. | Provider authority |
| Freeway live | PARTIAL | Runtime route was observed; original provider contract is not established. | Provider authority |
| CMS boards | PARTIAL | Runtime route was observed; original provider contract is not established. | Provider authority |
| Rail | PARTIAL | Runtime route and UI control were observed; source/terms need confirmation. | Adapter + attribution |
| Metro crowd | BLOCKED | TDX path returned HTTP 429 in recon; credential/rate-limit contract is unresolved. | Server adapter decision |
| Reservoirs | PARTIAL | Taiwan reservoir response and WRA fallback reference were observed; adapter/terms pending. | Adapter + attribution |
| Ports / marine | BLOCKED | 15 port records were observed through the Jimmy gateway, but exact source and terms are unknown. | Source identification |
| Wave | BLOCKED | Exact source and terms are unknown. | Source identification |
| Taiwan geocode/search | BLOCKED | `/api/geocode` was observed, but provider identity and terms are unknown. | Source identification |
| Search surface | FUNCTIONAL_MATCH | Frozen upstream search UI remains available; Taiwan provider is not substituted. | Taiwan search decision |
| HUD / cockpit | FUNCTIONAL_MATCH | Frozen MIT upstream HUD/cockpit is preserved. | Visual comparison |
| Layer controls | FUNCTIONAL_MATCH | Upstream controls retained; opt-in Taiwan basemap chips are additive. | Layer-state evidence |
| Visual filters/effects | FUNCTIONAL_MATCH | Upstream visual controls retained. | Screenshot comparison |

## Current interpretation

The candidate is deliberately not marked `PARITY_PASS` while Taiwan provider authority, candidate runtime screenshots, and the remaining reference interaction evidence are incomplete. Unknown/blocked rows are not silently represented by fake or inferred data.

## Evidence artifacts

The full sanitized recon is kept outside source during investigation:

- `/tmp/godeyes-taiwan-runtime-recon-20260927.har` — SHA-256 `0522acd534dd7ddd992944f1fc614889b54f0ce9fcff6e8746a0a90598e06c31`
- `/tmp/godeyes-taiwan-runtime-recon-20260927.json` — SHA-256 `a08c4a2362de61a230e2c7d306ab8e8ef70ad019d69eff6720eb0081aad0895d`
- `/tmp/godeyes-taiwan-runtime-recon-20260927.md` — SHA-256 `1b75d06084424fd7f5c3304ff6b99f9bf139ee069b87cc2168ac4f52b5a817b3`

The committed candidate must contain only sanitized snapshots/screenshots and source-authored compatibility evidence; no token, credential, or raw proprietary bundle is copied.

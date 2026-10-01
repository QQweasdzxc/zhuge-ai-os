# Jimmy Runtime API Compatibility Matrix

The paths below are compatibility observations from normal browser navigation. They are not Zhuge production endpoints. The candidate uses original public providers, frozen upstream providers, or an explicitly owned adapter only after source and terms are confirmed.

| Reference path | Observed protocol/shape | Candidate boundary | Status |
|---|---|---|---|
| `/api/flights` | GET JSON snapshot | Upstream OpenSky/server provider | `SERVER_PROXY_REQUIRED` |
| `/api/ais/ships` | GET JSON with `ships`, count, timestamps | Upstream AIS adapter; Taiwan transport not copied | `SERVER_PROXY_REQUIRED` |
| `/api/earthquakes` | GET GeoJSON / USGS metadata | Upstream USGS adapter | `REUSE_WITH_ATTRIBUTION` |
| `/api/cameras` | GET Taiwan camera catalogue | Taiwan-owned adapter only after source/terms | `ADAPTER_REQUIRED` |
| `/api/aqi` | GET station JSON | MOENV adapter after authority review | `ADAPTER_REQUIRED` |
| `/api/traffic` | GET incident JSON | Jimmy incident provider remains unknown; the candidate separately exposes official TDX provincial-highway live data at `/api/taiwan/tdx/highway/live` behind server-only OAuth | `ADAPTER_REQUIRED` |
| `/api/freeway/live` | GET highway data | Official source must be identified | `SERVER_PROXY_REQUIRED` |
| `/api/cms/live` | GET CMS board data | Official source must be identified | `ADAPTER_REQUIRED` |
| `/api/taiwan/tdx/highway/live` | GET official provincial-highway live traffic | TDX OAuth adapter; server-only and fail-closed when credentials are absent | `SERVER_PROXY_REQUIRED` |
| `/api/rail/live` | GET rail data | `/api/taiwan/tdx/rail/live` (TDX OAuth, server-only) | `SERVER_PROXY_REQUIRED` |
| `/api/tdx/metro/crowd` | GET; 429 in recon | TDX live-board adapter exists, but crowd contract remains unresolved | `BLOCKED_PROVIDER_UNKNOWN` |
| `/api/reservoirs` | GET reservoir JSON | WRA daily operation adapter plus bounded WRA storage-range geometry at `/api/taiwan/reservoirs/shapes` | `ADAPTER_REQUIRED` |
| `/api/marine/ports` | GET 15-record port response | Official MOA fishing-port catalogue plus MOTC Taipei Port observation are exposed through owned Taiwan adapters; exact Jimmy response semantics remain unresolved | `ADAPTER_REQUIRED` |
| `/api/geocode` | GET query result | Official NLSC text-geocoder adapter at `/api/taiwan/geocode`; current provider access is explicitly unavailable in this runtime and no fallback is guessed | `SERVER_PROXY_REQUIRED` |
| `/api/taiwan/marine/wave` | GET normalized Taipei Port observation | MOTC Institute of Transportation XML adapter; server-side normalization and cache | `ADAPTER_REQUIRED` |
| `/api/taiwan/ports/fishing` | GET normalized Taiwan fishing-port catalogue | MOA official open-data adapter; server-side normalization and cache | `ADAPTER_REQUIRED` |
| `/api/flightaware/live/flight/{callsign}` | GET HTML/proxy page | Proprietary page/data; never a Zhuge backend dependency | `NOT_RECOMMENDED` |
| `/api/twipcam/*` | GET widget/catalog proxy paths | Reference-only gateway | `UNKNOWN` |

## Contract rule

The normalized Taiwan adapter contract is defined in `src/data/taiwanProviderContract.js` and includes `providerId`, `source`, `fetchedAt`, `dataTimestamp`, `status`, `stale`, `attribution`, `license`, `geographicCoverage`, `entities`, `features`, and `providerMetadata`. UI code must not consume a Jimmy payload shape directly.

## Safety rule

No implementation in this candidate may import or fetch `https://godeyes.jimmy-dev.win/api/*`. The reference host remains a behavioral and network-contract reference only.

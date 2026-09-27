# Taiwan Provider Architecture

## Boundary

```text
God's Eye View UI / layer architecture
        |
Taiwan Data Orchestrator (server boundary)
        |
Taiwan Provider Pack adapters
        |
official public provider / upstream provider / explicitly reviewed source
```

`global` mode remains the default. `taiwan-enhanced` is opt-in and currently wires the confirmed NLSC WMTS source plus the first CWA Wave 1 adapters (radar, typhoon, and regional GFS wind) into the existing weather/wind/cyclone layer lifecycle. Taiwan-specific parsing remains in the server/provider boundary; UI components consume normalized layer snapshots only.

## Normalized evidence

Every adapter returns:

```js
{
  providerId,
  source,
  fetchedAt,
  dataTimestamp,
  status,
  stale,
  attribution,
  license,
  geographicCoverage,
  entities,
  features,
  providerMetadata,
}
```

Unknown, unavailable, not-configured, stale, and license-review states remain explicit. A missing provider is never replaced with a costumed success payload.

## NLSC E2E spike

The first real provider spike is NLSC WMTS EMAP/PHOTO2. `src/maps/imagery.js` uses the official URL-template tile source and renders attribution. `server/providers/taiwan/nlsc.js` provides safe URL construction and a sanitized tile probe. `server/providers/taiwan/orchestrator.js` exposes only this confirmed probe; no Jimmy API gateway is used.

## CWA Wave 1 E2E spike

The CWA Wave 1 proof uses the existing weather/cyclone/wind layer contracts:

- Radar: the official CWA public PNG is served through a bounded read-through route and normalized as a one-frame `imageUrl` snapshot with Taiwan bounds, source, observed time, stale state, and attribution.
- Typhoon: the CWA-labelled KML is parsed server-side into the existing cyclone snapshot contract. Track, cone, forecast points, selection, and camera focus use the upstream cyclone layer behavior.
- Wind: the CWA-labelled GFS regional grid is parsed into the existing binary U/V grid contract. Regional bounds are preserved; sampling and Canvas rendering clamp to the regional extent instead of wrapping a partial grid around the globe.

The repeatable browser proof is `npm run qa:taiwan-cwa`. It enables and disables each layer, captures sanitized stats/diagnostics, exercises typhoon selection/focus and wind speed overlay, records only request metadata, asserts zero Jimmy gateway requests, and writes `candidate-cwa-browser-evidence.json`. CWA public reachability is not treated as production reuse permission; the registry remains `license_review_required` until current CWA/hosting terms are confirmed.

## Taiwan CCTV Wave 2 evidence

The isolated candidate now has three official catalog adapters behind the existing
CCTV source contract. Taipei City data contributes 417 normalized camera points,
New Taipei City contributes 30 points, and the Freeway Bureau XML contributes
1,874 points before the shared browser cap. The browser proof is
`npm run qa:taiwan-cctv`; it records only counts, coordinates, source kinds,
selection state, request metadata, and media headers.

- Taipei: metadata-only. The official catalog is useful for map placement, but
  live traffic-image reuse remains disabled pending the dataset owner's
  application/contract path.
- New Taipei: metadata-only. The catalog-to-live URL relationship has not been
  proven, so the adapter emits no guessed media URL.
- Freeway: the official XML catalog is used and the pinned official freeway host
  is allowed for a bounded single JPEG frame. Multipart MJPEG is reduced to one
  bounded frame; no continuous stream is proxied by this parity spike.

All three remain separate from the Jimmy same-origin gateway. `sourceKind`,
provider attribution, and unavailable media states remain explicit at the server
boundary; the browser never receives provider credentials or raw upstream
catalog payloads.

## WRA reservoir foundation

The Taiwan reservoir source is now confirmed independently of the Jimmy gateway:
the read-only adapter uses the Water Resources Agency daily reservoir operation
dataset, normalizes only published fields, bounds the response, coalesces
concurrent reads, and serves stale evidence when a previously successful source
becomes unavailable. The route is `/api/taiwan/reservoirs`; it is not yet a
Jimmy-parity layer consumer, so the parity matrix remains `PARTIAL` until a
candidate layer and visual/interaction proof are added.

## MOENV AQI foundation

The official MOENV AQI dataset is represented by a server-only adapter at
`/api/taiwan/aqi`. It requires the protected `MOENV_API_KEY` environment
variable; without that secret the route returns the explicit
`PROVIDER_NOT_CONFIGURED` state and never contacts the upstream API. The
browser proof therefore verifies the fail-closed boundary only; it is not live
AQI evidence until a controlled environment supplies the key.

## Freeway live traffic and CMS foundation

The Taiwan parity branch now has two read-only adapters for the official Taiwan
Freeway Bureau feeds:

- `https://tisvcloud.freeway.gov.tw/history/motc20/LiveTraffic.xml`
- `https://tisvcloud.freeway.gov.tw/history/motc20/CMSLive.xml`

They are exposed only through `/api/taiwan/freeway/live` and
`/api/taiwan/freeway/cms`, respectively. XML is bounded and normalized on the
server; the browser receives provider/source/update/stale metadata and sanitized
entities, never the raw XML. The adapters use a short TTL, in-flight request
coalescing, and stale-on-error behavior. The candidate's Taiwan-specific
`taiwan-freeway-live` and `taiwan-freeway-cms` consumers join the live feeds to
the official daily geometry/location catalogs before rendering. The existing
global traffic layer remains unchanged.

## Cache and request safety

`server/providers/taiwan/cache.js` provides bounded in-memory TTL caching, in-flight request coalescing, and stale fallback for server adapters. This is enough for the first read-only tile/evidence spike; provider-specific persistent caching and rate limits remain a later gate.

TDX was observed returning HTTP 429 during recon and therefore remains server-only/not-configured until credentials, limits, TTL, backoff, and attribution are confirmed.

## CCTV boundary

Camera catalog metadata and camera media are separate concerns. A future adapter may cache a catalog, while HLS/MJPEG media remains direct/provider-owned unless a security or CORS decision explicitly authorizes proxying. The observed Taiwan media hosts are not activated in this candidate because public reachability does not establish reuse permission.

## Mode invariant

Disabling Taiwan enhanced mode preserves the frozen upstream/global defaults and hides Taiwan-only map stacks. The source path is additive; it does not alter the global provider authority or current production SkyEye.

### Freeway traffic and CMS map consumers

The Taiwan parity candidate keeps the official Freeway Bureau feeds behind the
server boundary. `LiveTraffic.xml` is joined with the daily `SectionShape.xml`
catalog before the browser receives section geometry. `CMSLive.xml` is joined
with the daily `CMS.xml` catalog before the browser receives sign coordinates.
The two read-only layer consumers are `taiwan-freeway-live` and
`taiwan-freeway-cms`; they do not replace the existing global traffic layer.
The feeds are cached and sanitized, and the UI never receives raw XML.

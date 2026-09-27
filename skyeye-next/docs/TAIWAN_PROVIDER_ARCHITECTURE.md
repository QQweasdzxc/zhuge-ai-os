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

`global` mode remains the default. `taiwan-enhanced` is opt-in and currently changes only the initial/available basemap stacks to the confirmed NLSC WMTS source. Taiwan-specific logic does not enter UI components as provider payload parsing.

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

## Cache and request safety

`server/providers/taiwan/cache.js` provides bounded in-memory TTL caching, in-flight request coalescing, and stale fallback for server adapters. This is enough for the first read-only tile/evidence spike; provider-specific persistent caching and rate limits remain a later gate.

TDX was observed returning HTTP 429 during recon and therefore remains server-only/not-configured until credentials, limits, TTL, backoff, and attribution are confirmed.

## CCTV boundary

Camera catalog metadata and camera media are separate concerns. A future adapter may cache a catalog, while HLS/MJPEG media remains direct/provider-owned unless a security or CORS decision explicitly authorizes proxying. The observed Taiwan media hosts are not activated in this candidate because public reachability does not establish reuse permission.

## Mode invariant

Disabling Taiwan enhanced mode preserves the frozen upstream/global defaults and hides Taiwan-only map stacks. The source path is additive; it does not alter the global provider authority or current production SkyEye.

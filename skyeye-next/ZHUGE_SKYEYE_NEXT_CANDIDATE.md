# SkyEye Next Desktop Candidate

This directory is an isolated, vendored snapshot of God's Eye View for a
desktop UX candidate. It is intentionally not merged into the existing
`modules/skyeye/` application and does not replace the current SkyEye route.

## Frozen upstream baseline

- Repository: <https://github.com/bilawalsidhu/gods-eye-view>
- Commit: `b210ab0fe4d71c7faa0268134e0aa5f3c53fc7fe`
- Snapshot method: upstream tracked files archived at the exact commit
- License: upstream MIT; third-party data/assets retain their own terms in
  `DATA_SOURCES.md`, `THIRD_PARTY_NOTICES.md`, and `public/models/README.md`

## Candidate boundary

```text
Zhuge authenticated/navigation boundary
  -> /skyeye-next/ candidate entry
  -> isolated upstream application
  -> upstream server/provider routes and upstream data behavior
```

The only candidate compatibility layer is
`compatibility/zhuge-skyeye-next-dev.mjs`. It provides an isolated HTTP entry
point, proxies same-origin upstream requests, and exposes a sanitized health
endpoint. It does not modify the upstream visual language, layer catalog,
provider adapters, or application state model.

Run from this directory after `npm ci`:

```sh
node compatibility/zhuge-skyeye-next-dev.mjs
```

Then open `http://127.0.0.1:4174/skyeye-next/`.

## Upstream provider/key matrix

The candidate preserves upstream behavior. Keyless or fallback-capable paths
remain available as upstream provides them; optional key-dependent paths remain
disabled/not configured when their upstream environment variables are absent.

| Capability | Upstream behavior | Candidate rule |
| --- | --- | --- |
| Cesium globe / keyless terrain and imagery fallback | Available through upstream defaults | Preserve |
| Aircraft / military traffic | Upstream anonymous/fallback path where available | Preserve |
| Satellites / earthquakes / launches / public cameras / radio | Upstream sources | Preserve |
| Google 3D / Places | `GOOGLE_MAPS_API_KEY` optional | Do not add or copy a key |
| Cesium Ion | `CESIUM_ION_TOKEN` optional | Do not add or copy a token |
| OpenAI voice | `OPENAI_API_KEY` optional | Remains upstream-configured only |
| AISStream vessels | `AISSTREAM_API_KEY` optional | Remains disabled if absent |
| FIRMS fires | `FIRMS_MAP_KEY` optional | Remains disabled if absent |
| TomTom traffic | `TOMTOM_API_KEY` optional | Remains disabled if absent |
| OpenSky OAuth | Upstream OAuth configuration | Remains upstream-configured only |
| Launch Library | Upstream optional token | Remains upstream-configured only |

No credential values are included in this candidate, source tree, or health
response.

## Acceptance surface

The PM desktop review should exercise the upstream application at the candidate
route: globe rendering, camera navigation, main panels, layer controls,
aircraft selection/tracking, cockpit/HUD, visual effects, fullscreen sizing,
and keyboard/pointer interactions. A successful candidate review does not
authorize mobile adaptation, API replacement, or production cutover.

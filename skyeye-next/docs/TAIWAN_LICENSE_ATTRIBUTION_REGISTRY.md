# Taiwan License and Attribution Registry

This registry separates observed public reachability from permission to reuse or redistribute.

| Provider/source | Attribution | License / ToS state | Candidate disposition |
|---|---|---|---|
| NLSC EMAP/PHOTO2 WMTS | Taiwan National Land Surveying and Mapping Center | Endpoint reachable; current reuse terms still require confirmation | Opt-in E2E spike with visible attribution; production activation remains review-gated |
| CWA radar PNG | Central Weather Administration | Public asset observed; current redistribution terms require confirmation | Registry only |
| CWA/Twipcam GFS/KML | CWA attribution; hosting boundary unresolved | Review required | Registry only |
| Taipei CCTV | Taipei City Government/source owner | Public media reachability is not reuse permission | Registry only |
| New Taipei CCTV | New Taipei City Government/source owner | Public media reachability is not reuse permission | Registry only |
| Freeway CCTV | Taiwan Freeway Bureau/source owner | Public media reachability is not reuse permission | Registry only |
| TDX | TDX | Registration/rate terms and credential boundary unresolved | Not configured |
| MOENV AQI | Taiwan Ministry of Environment | Current API terms require confirmation | Not configured |
| USGS | USGS | Upstream attribution boundary retained; review before Taiwan relabeling | Reuse with attribution |
| OpenSky / AISStream | Upstream provider labels | Existing upstream provider terms remain authoritative | Existing upstream adapters |
| FlightAware | FlightAware | Proprietary page/data; no reuse evidence | Not recommended |
| Jimmy `/api/*` gateway | Jimmy runtime | No production reuse permission or stability contract established | Reference only; never a dependency |

Upstream MIT attribution remains governed by the existing `LICENSE` and `DATA_SOURCES.md`. No Jimmy-specific compiled bundle or proprietary asset is copied into this candidate.

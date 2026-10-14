# Issue #45 — integrated attachment preview candidate

Candidate: `0.9.0-alpha.9.38` / Build `20261014-1040`.
Base: deployed TaskFlow `.9.37`, Commit `61e4456bf96dd9af263fbc436e6aea4fc21f7896`.
Source scope: the TaskFlow attachment-preview staged-source overlay and its
tests, plus the Docker Build Parity invocation for those tests. Standard
`.9.38` release identity and cache-buster projections are synchronized across
the root app so clients load one source build; no other module business logic
changed. The #44 Project Status changes remain as released in the base. No #42
SQL or Connector changes are included.

## PDF and image preview

Frozen Multica's native PDF branch passes `state.mediaUrl` directly to an
`<iframe>`. The TaskFlow overlay corrects that path to use the resolved media
URL. The shared `useResignedInlineMedia` hook also skipped a same-origin,
Bearer-token-only deployment because it only re-signed when an API base URL was
configured or the URL was cross-origin. Native media elements cannot attach the
Web API client's Bearer header, so that case could still receive
`missing authorization`.

The TaskFlow-owned staged-source patch now:

- re-signs protected attachment URLs when a Bearer token is present, including
  same-origin deployments;
- supplies the resolved URL to the PDF iframe;
- uses the existing authenticated Blob fetch for proxy-mode images and PDFs up
  to 8 MiB;
- avoids buffering larger proxy-mode PDFs and offers the existing download
  fallback when no signed preview URL is available;
- offers a download fallback for images when authenticated URL resolution
  fails instead of rendering a protected raw URL;
- continues using the load-intent `download_url`, not the forced-download
  `attachment_download_url`.

The patch fails closed if pinned upstream markers drift or if applied twice.
It modifies only the staged build copy; `third_party/multica/` remains
unchanged.

## 13.5 MB PPTX HTTP 500

The reported failure remains **OPEN / NOT REPRODUCED; root cause unidentified**.
The application request limit is 100 MiB, so 13.5 MB is below that limit; this
alone does not identify the cause. No upload limit or storage behavior is
changed. A correlated failing request timestamp or request ID, sanitized
response body, and matching API/storage error are still needed.

## Evidence and limits

- Original #45 candidate `b116610c8da911746b189d3a2225b97abf37ffd1` had GitHub
  Build Parity Run `38498136734` with overlay-contract, backend-image, and
  web-image jobs successful. That run covers the exact attachment patch and
  targeted hook test source ported here.
- The integrated candidate receives one new GitHub Build Parity run against
  the exact integrated commit; report its result with the Review Ref.
- Real authenticated preview/render/download in a browser is **NOT VERIFIED**.
- The reported 13.5 MB PPTX failure is **NOT REPRODUCED** and remains open.
- This candidate does not modify Production settings, data, Render services,
  Supabase, or database schema.

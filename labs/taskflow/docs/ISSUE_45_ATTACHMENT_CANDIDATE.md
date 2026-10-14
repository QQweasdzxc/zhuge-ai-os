# Issue #45 — attachment preview and large PPTX upload

Candidate: `0.9.0-alpha.9.37` / Build `20261014-0949`.
Base: `.9.37` source (`6df9f12ae5433048776db400a441d365bb99955f`).
This candidate changes only the TaskFlow attachment preview build overlay, its
tests, and the Build Parity branch trigger. Frozen Multica source is unchanged.
The product version remains `.9.37`; this source change uses a new synchronized
Build ID. Standard generated Build identity projections were synchronized by
the repository release-governance tool.

## PDF and image preview

### Confirmed source causes

Frozen Multica's native PDF branch passes `state.mediaUrl` directly to an
`<iframe>`. The existing `.9.37` TaskFlow overlay already corrected that path
to use the resolved media URL. The remaining `.9.37` candidate gap was in the
shared `useResignedInlineMedia` hook: it requested fresh attachment metadata
only for a non-empty API base URL or a cross-origin URL, skipping the
same-origin, Bearer-token-only case. Native iframe/image requests cannot attach
the Web API client's Bearer header, so that case could still use an endpoint
that returns `missing authorization`.

### Candidate behavior

The TaskFlow-owned staged-source patch now:

- includes an active Bearer token in the hook's re-sign decision, including
  same-origin deployments;
- supplies the hook's resolved URL to the PDF iframe;
- uses the existing authenticated Blob fetch for proxy-mode images and PDFs
  up to 8 MiB;
- avoids buffering larger proxy-mode PDFs and presents the existing safe
  download fallback when no signed preview URL is available;
- presents a download fallback for images when the authenticated upgrade
  fails, instead of silently rendering the protected raw URL;
- continues to use the load-intent `download_url`, never the forced-download
  `attachment_download_url`.

The patch script fails closed if the pinned upstream markers drift or the
overlay is applied twice. It modifies a staged build copy only; it does not
edit `third_party/multica/`.

## 13.5 MB PPTX HTTP 500

The reported failure's root cause remains **UNIDENTIFIED / NOT REPRODUCED**.
The native upload handler's configured application body limit is 100 MiB, so
13.5 MB is below that limit; this fact alone does not explain a server error.
The handler can return HTTP 500 when the configured storage adapter fails, but
the available production log query did not return a correlated 500, request
ID, or storage error for the reported upload. The available API logs show
successful upload requests and local filesystem storage initialization; they
do not establish what happened to the reported PPTX request. No upload limit,
storage configuration, or backend code was changed.

To identify this failure, a reproduction needs the failed request timestamp or
request ID, sanitized response body, and matching API/storage error. File
contents and credentials are not needed. Until that correlated evidence is
available, the PPTX issue remains open and must not be described as fixed.

## Evidence and limits

- Overlay contract tests: **2 PASS**; include staged application,
  upstream-drift failure, and frozen-vendor hash checks.
- Hook tests: **5 PASS** for same-origin Bearer token, cross-origin protected
  URL, proxy Blob path, failed authorization upgrade, and cookie-only
  same-origin behavior.
- Existing preview modal tests: **79 PASS** against the patched staged source.
- Combined targeted Vitest run: **84 PASS**; isolated staged source, not a
  production runtime test.
- Authenticated real-browser preview in same-origin, cross-origin, and proxy
  deployments: **NOT VERIFIED** in this candidate environment.
- Real download and image/PDF rendering in a browser: **NOT VERIFIED**.
- Local Web Docker build: **BLOCKED** before overlay/build steps because the
  Alpine package index download for `python3` returned `Permission denied`.
  GitHub Actions run/status reads returned no accessible result; the GitHub
  Actions API request was forbidden, so remote Build Parity is **NOT VERIFIED**.
- Reported 13.5 MB PPTX upload: **NOT REPRODUCED; ROOT CAUSE UNIDENTIFIED**.
- No Production setting, data, Render service, or database was modified.

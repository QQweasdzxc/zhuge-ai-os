# Issue #45 — attachment preview / upload candidate

## Preview root cause and candidate fix

The frozen Multica preview modal already resolves authenticated attachment
metadata with `useResignedInlineMedia`, but the native PDF branch bypassed the
resolved URL and loaded `state.mediaUrl` directly in an `<iframe>`. A cross-
origin or split-origin protected `/api/attachments/<id>/download` request
cannot carry the TaskFlow Bearer header, so the PDF viewer received an
authorization error even though the existing Download action re-signs through
the authenticated API.

The TaskFlow Web build overlay now feeds the PDF iframe the same re-signed URL.
For proxy-mode PDFs with no signed storage URL, it uses the existing
authenticated blob fetch only when the attachment metadata reports a size
from 1 byte through 8 MiB. It does not buffer larger documents into browser
memory. If a protected URL cannot be upgraded, it renders the existing
unsupported-preview state and Download action rather than retrying the raw
protected URL. Images and the native download path are unchanged.

The patch is applied only to the staged build copy of
`packages/views/editor/attachment-preview-modal.tsx`; Frozen Vendor remains
unchanged. Overlay contract tests verify expected upstream markers, preserved
vendor hash, the re-signed PDF URL, and the bounded fallback.

## Large PPTX upload

The reported 13.5 MB PPTX HTTP 500 remains **NOT REPRODUCED**. Source checks
show the browser posts `FormData` to `/api/upload-file`; the backend request
limit is 100 MiB and the handler then reads the file before calling the
configured storage adapter. Therefore 13.5 MB is below the application limit,
but that does not identify the cause of the observed 500. No new backend
upload failure log or isolated storage reproduction is available in this
candidate. No upload limit or Storage behavior was changed.

The minimum evidence to isolate that separate failure is one failing request's
timestamp/request ID, response body, and matching API/storage error (with
credentials and file contents excluded). Until then the upload failure remains
open; the PDF preview candidate does not claim to fix it.

## QA boundary

- Overlay contract tests: PASS (2 tests).
- Real authenticated PDF preview/download in an isolated browser: NOT VERIFIED.
- Upload and 13.5 MB PPTX reproduction: NOT VERIFIED.
- Frozen Vendor: unchanged by the patch; the test compares the vendor source
  hash before and after applying to a temporary copy.

#!/usr/bin/env python3
"""Apply the TaskFlow authenticated attachment-preview fix to staged source."""

from __future__ import annotations

import argparse
from pathlib import Path


TARGET = Path("packages/views/editor/attachment-preview-modal.tsx")
INLINE_MEDIA_TARGET = Path("packages/views/editor/hooks/use-inline-media-url.ts")


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise ValueError(f"{label}: expected one upstream marker, found {count}")
    return source.replace(old, new, 1)


def patch(source: str) -> str:
    if "TASKFLOW_AUTHENTICATED_PDF_PREVIEW" in source:
        raise ValueError("TaskFlow authenticated PDF preview already applied")
    source = replace_once(
        source,
        '''  const resigned = useResignedInlineMedia(
    state.attachmentId ?? undefined,
    state.mediaUrl,
    kind === "image",
  );''',
        '''  // TASKFLOW_AUTHENTICATED_PDF_PREVIEW: use the existing authenticated
  // re-sign path for PDFs. Only small proxy-mode PDFs may use a Blob fallback;
  // large documents remain streamed by signed URL or show the download CTA.
  const boundedPdfBlobFallback = kind === "pdf"
    && state.sizeBytes > 0
    && state.sizeBytes <= 8 * 1024 * 1024;
  const resigned = useResignedInlineMedia(
    state.attachmentId ?? undefined,
    state.mediaUrl,
    kind === "image" || boundedPdfBlobFallback,
  );
  const pdfPreviewUrl = kind === "pdf" ? resigned.url : undefined;
  const pdfNeedsAuthenticatedFallback = kind === "pdf" && resigned.unavailable;''',
        "re-sign PDFs and bound authenticated Blob fallback",
    )
    source = replace_once(
        source,
        '''            <PreviewContent
              kind={kind}
              source={source}
              state={state}
              view={view}
              onDownload={onDownload}
              onBackdropClick={closeOnBackdrop}
            />''',
        '''            <PreviewContent
              kind={kind}
              source={source}
              state={state}
              view={view}
              mediaUrl={pdfPreviewUrl}
              mediaPending={kind === "pdf" && resigned.pending}
              mediaUnavailable={pdfNeedsAuthenticatedFallback}
              onDownload={onDownload}
              onBackdropClick={closeOnBackdrop}
            />''',
        "pass authenticated PDF preview state",
    )
    source = replace_once(
        source,
        '''  state,
  view,
  onDownload,
  onBackdropClick,
}: {
  kind: Exclude<PreviewKind, "image"> | null;
  source: PreviewSource;
  state: PreviewState;
  view: StageView;
  onDownload: () => void;''',
        '''  state,
  view,
  mediaUrl,
  mediaPending,
  mediaUnavailable,
  onDownload,
  onBackdropClick,
}: {
  kind: Exclude<PreviewKind, "image"> | null;
  source: PreviewSource;
  state: PreviewState;
  view: StageView;
  mediaUrl?: string;
  mediaPending?: boolean;
  mediaUnavailable?: boolean;
  onDownload: () => void;''',
        "PreviewContent media props",
    )
    source = replace_once(
        source,
        '''    case "pdf":
      return (
        <div className="h-full pb-4">
          <iframe
            src={state.mediaUrl}
            className="h-full w-full rounded-lg bg-background"
            title={state.filename}
          />
        </div>
      );''',
        '''    case "pdf":
      if (mediaPending) {
        return (
          <div className="dark flex h-full items-center justify-center" role="status">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        );
      }
      if (mediaUnavailable || !mediaUrl) {
        return (
          <UnsupportedFallback
            message={t(($) => $.attachment.preview_unsupported)}
            onDownload={onDownload}
          />
        );
      }
      return (
        <div className="h-full pb-4">
          <iframe
            src={mediaUrl}
            className="h-full w-full rounded-lg bg-background"
            title={state.filename}
          />
        </div>
      );''',
        "PDF uses authenticated URL or safe fallback",
    )
    source = replace_once(
        source,
        '''  const targetUrl = resigned.pending ? "" : resigned.url;''',
        '''  // Never let a native media element retry a URL after its authenticated
  // upgrade was rejected; the UI below offers the authorized download action.
  const targetUrl = resigned.pending || resigned.unavailable ? "" : resigned.url;''',
        "do not render protected URL after failed upgrade",
    )
    source = replace_once(
        source,
        '''          {kind === "image" ? (
            <ImagePreview
              state={state}
              mediaUrl={mediaUrl}
              canvas={canvas}
              natural={natural}
              onNaturalSize={handleNaturalSize}
              onError={imageLoadError}
            />
          ) : (''',
        '''          {kind === "image" ? (
            resigned.unavailable ? (
              <UnsupportedFallback
                message={t(($) => $.attachment.preview_failed)}
                onDownload={onDownload}
              />
            ) : (
              <ImagePreview
                state={state}
                mediaUrl={mediaUrl}
                canvas={canvas}
                natural={natural}
                onNaturalSize={handleNaturalSize}
                onError={imageLoadError}
              />
            )
          ) : (''',
        "images fail closed to a download fallback when authenticated upgrade fails",
    )
    return source


def patch_inline_media(source: str) -> str:
    if "TASKFLOW_TOKEN_AUTH_ATTACHMENT_RESIGN" in source:
        raise ValueError("TaskFlow token-auth attachment re-sign already applied")
    source = replace_once(
        source,
        '''  const needsResign =
    !!resignAttachmentId &&
    !!pickedUrl &&
    idFromPickedUrl !== undefined &&
    ((api.getBaseUrl?.() ?? "") !== "" || isCrossOriginWebURL);''',
        '''  // TASKFLOW_TOKEN_AUTH_ATTACHMENT_RESIGN: native media elements cannot
  // send the Web API client's Bearer header, even when their URL is same-origin.
  const needsResign =
    !!resignAttachmentId &&
    !!pickedUrl &&
    idFromPickedUrl !== undefined &&
    ((api.getBaseUrl?.() ?? "") !== "" || isCrossOriginWebURL || !!api.getToken?.());''',
        "token-only same-origin attachment re-sign",
    )
    source = replace_once(
        source,
        '''): { url: string; pending: boolean } {''',
        '''): { url: string; pending: boolean; unavailable: boolean } {''',
        "inline-media availability result type",
    )
    source = replace_once(
        source,
        '''  if (!needsResign) return { url: pickedUrl, pending: false };''',
        '''  if (!needsResign) return { url: pickedUrl, pending: false, unavailable: false };''',
        "no-upgrade media result",
    )
    source = replace_once(
        source,
        '''  if (signedUrl) return { url: signedUrl, pending: false };''',
        '''  if (signedUrl) return { url: signedUrl, pending: false, unavailable: false };''',
        "signed media result",
    )
    source = replace_once(
        source,
        '''    blobUrlCache.get(resignAttachmentId) === blobUrl
  ) {
    return { url: blobUrl, pending: false };
  }
  if (blobUrl && !resignAttachmentId && isAuthenticated) {
    return { url: blobUrl, pending: false };
  }''',
        '''    blobUrlCache.get(resignAttachmentId) === blobUrl
  ) {
    return { url: blobUrl, pending: false, unavailable: false };
  }
  if (blobUrl && !resignAttachmentId && isAuthenticated) {
    return { url: blobUrl, pending: false, unavailable: false };
  }''',
        "authenticated Blob media result",
    )
    source = replace_once(
        source,
        '''  const pending = !freshFailed && (!fresh || (blobFallback && !blobFailed));
  return { url: pickedUrl, pending };''',
        '''  const pending = !freshFailed && (!fresh || (blobFallback && !blobFailed));
  const unavailable = needsResign && !pending && (
    freshFailed ||
    (!!fresh && !signedUrl && !blobFallback) ||
    (!!fresh && !signedUrl && blobFallback && blobFailed)
  );
  return { url: pickedUrl, pending, unavailable };''',
        "failed media upgrade result",
    )
    return source


def apply(root: Path) -> None:
    path = root / TARGET
    path.write_text(patch(path.read_text()))
    hook = root / INLINE_MEDIA_TARGET
    hook.write_text(patch_inline_media(hook.read_text()))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("third_party/multica"))
    args = parser.parse_args()
    apply(args.root)


if __name__ == "__main__":
    main()

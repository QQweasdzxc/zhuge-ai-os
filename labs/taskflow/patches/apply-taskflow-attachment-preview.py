#!/usr/bin/env python3
"""Apply the TaskFlow authenticated attachment-preview fix to staged source."""

from __future__ import annotations

import argparse
from pathlib import Path


TARGET = Path("packages/views/editor/attachment-preview-modal.tsx")


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
        'import {\n  PreviewTooLargeError,\n  PreviewUnsupportedError,\n} from "@multica/core/api";\n',
        'import {\n  api,\n  PreviewTooLargeError,\n  PreviewUnsupportedError,\n} from "@multica/core/api";\n'
        'import { attachmentIdFromDownloadURL } from "@multica/core/types/attachment-url";\n',
        "authenticated preview imports",
    )
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
  const crossOriginMediaUrl = (() => {
    if (!/^https?:\\/\\//i.test(state.mediaUrl) || typeof window === "undefined") return false;
    try {
      return new URL(state.mediaUrl).origin !== window.location.origin;
    } catch (_err) {
      void _err;
      return false;
    }
  })();
  const pdfPreviewUrl = kind === "pdf" ? resigned.url : undefined;
  const pdfNeedsAuthenticatedFallback = kind === "pdf"
    && attachmentIdFromDownloadURL(state.mediaUrl) !== undefined
    && ((api.getBaseUrl?.() ?? "") !== "" || crossOriginMediaUrl)
    && pdfPreviewUrl === state.mediaUrl
    && !resigned.pending;''',
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
    return source


def apply(root: Path) -> None:
    path = root / TARGET
    path.write_text(patch(path.read_text()))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("third_party/multica"))
    args = parser.parse_args()
    apply(args.root)


if __name__ == "__main__":
    main()

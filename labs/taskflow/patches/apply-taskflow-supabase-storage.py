#!/usr/bin/env python3
"""Stage the TaskFlow private Supabase Storage adapter without editing vendor."""

from __future__ import annotations

import argparse
import re
import shutil
from pathlib import Path


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise ValueError(f"{label}: expected one upstream marker, found {count}")
    return source.replace(old, new, 1)


def replace_exact_count(source: str, old: str, new: str, count: int, label: str) -> str:
    found = source.count(old)
    if found != count:
        raise ValueError(f"{label}: expected {count} upstream markers, found {found}")
    return source.replace(old, new)


def patch_router(source: str) -> str:
    source = replace_once(
        source,
        '''\t"Authorization",\n\t"Content-Type",''',
        '''\t"Authorization",\n\t"X-Zhuge-Storage-Token",\n\t"Content-Type",''',
        "Storage JWT CORS header",
    )
    source = replace_once(
        source,
        '''\t// Initialize storage with S3 as primary, fallback to local\n\tvar store storage.Storage\n\ts3 := storage.NewS3StorageFromEnv()\n\tif s3 != nil {\n\t\tstore = s3\n\t} else {\n\t\tlocal := storage.NewLocalStorageFromEnv()\n\t\tif local != nil {\n\t\t\tstore = local\n\t\t}\n\t}''',
        '''\t// TaskFlow keeps its existing non-attachment storage paths and sends
\t// only native UUIDv7 attachment objects to the private Supabase bucket.
\t// Missing or invalid Supabase configuration is fail-closed; attachments
\t// never fall back to Render's ephemeral local disk.
\tvar store storage.Storage
\tswitch strings.TrimSpace(os.Getenv("TASKFLOW_STORAGE_PROVIDER")) {
\tcase "supabase":
\t\tattachments, err := storage.NewTaskFlowSupabaseStorageFromEnv()
\t\tif err != nil {
\t\t\tpanic(fmt.Errorf("TaskFlow Supabase attachment Storage is required: %w", err))
\t\t}
\t\tlocal := storage.NewLocalStorageFromEnv()
\t\tif local == nil {
\t\t\tpanic("TaskFlow existing non-attachment Storage could not be initialized")
\t\t}
\t\tstore, err = storage.NewTaskFlowScopedStorage(attachments, local)
\t\tif err != nil {
\t\t\tpanic(fmt.Errorf("TaskFlow Storage routing could not be initialized: %w", err))
\t\t}
\tcase "":
\t\ts3 := storage.NewS3StorageFromEnv()
\t\tif s3 != nil {
\t\t\tstore = s3
\t\t} else {
\t\t\tstore = storage.NewLocalStorageFromEnv()
\t\t}
\tdefault:
\t\tpanic("unsupported TASKFLOW_STORAGE_PROVIDER")
\t}''',
        "TaskFlow fail-closed Storage selection",
    )
    source = replace_once(
        source,
        'r.Post("/api/upload-file", h.UploadFile)',
        'r.With(middleware.RequireTaskFlowSupabaseStorageIdentity).Post("/api/upload-file", h.UploadFile)',
        "upload route storage identity gate",
    )
    source = replace_once(
        source,
        'r.Get("/api/attachments/{id}/download", h.DownloadAttachment)',
        'r.With(middleware.RequireTaskFlowSupabaseStorageIdentity).Get("/api/attachments/{id}/download", h.DownloadAttachment)',
        "download route storage identity gate",
    )
    source = replace_once(
        source,
        'r.Get("/api/attachments/{id}", h.GetAttachmentByID)',
        'r.With(middleware.RequireTaskFlowSupabaseStorageIdentity).Get("/api/attachments/{id}", h.GetAttachmentByID)',
        "metadata route storage identity gate",
    )
    source = replace_once(
        source,
        'r.Get("/api/attachments/{id}/content", h.GetAttachmentContent)',
        'r.With(middleware.RequireTaskFlowSupabaseStorageIdentity).Get("/api/attachments/{id}/content", h.GetAttachmentContent)',
        "content route storage identity gate",
    )
    source = replace_once(
        source,
        'r.Delete("/api/attachments/{id}", h.DeleteAttachment)',
        'r.With(middleware.RequireTaskFlowSupabaseStorageIdentity).Delete("/api/attachments/{id}", h.DeleteAttachment)',
        "delete route storage identity gate",
    )
    return source


def patch_file_handler(source: str) -> str:
    source = replace_once(source, "const maxUploadSize = 100 << 20 // 100 MB", "const maxUploadSize = 51_000_000 // 50 MB object cap plus multipart framing", "TaskFlow request cap")
    source = replace_once(
        source,
        '''\tif err := r.ParseMultipartForm(maxUploadSize); err != nil {\n\t\twriteError(w, http.StatusBadRequest, "file too large or invalid multipart form")\n\t\treturn\n\t}''',
        '''\tif err := r.ParseMultipartForm(maxUploadSize); err != nil {\n\t\tvar maxBytesError *http.MaxBytesError\n\t\tif errors.As(err, &maxBytesError) {\n\t\t\twriteError(w, http.StatusRequestEntityTooLarge, "attachment exceeds the TaskFlow 50 MB limit")\n\t\t} else {\n\t\t\twriteError(w, http.StatusBadRequest, "invalid multipart attachment request")\n\t\t}\n\t\treturn\n\t}''',
        "TaskFlow upload error status",
    )
    upload_error_pattern = re.compile(
        r'(?P<indent>\t+)slog\.Error\("file upload failed", "error", err\)\n'
        r'(?P=indent)writeError\(w, http\.StatusInternalServerError, "upload failed"\)\n'
        r'(?P=indent)return'
    )

    def map_upload_error(match: re.Match[str]) -> str:
        indent = match.group("indent")
        return (
            f'{indent}slog.Error("file upload failed", "error", err)\n'
            f'{indent}if !writeTaskFlowStorageError(w, err, http.StatusBadGateway, "private attachment storage is unavailable") {{\n'
            f'{indent}\twriteError(w, http.StatusInternalServerError, "upload failed")\n'
            f'{indent}}}\n'
            f'{indent}return'
        )

    source, upload_error_count = upload_error_pattern.subn(map_upload_error, source)
    if upload_error_count != 2:
        raise ValueError(f"upload failure status mapping: expected 2 upstream markers, found {upload_error_count}")
    source = replace_once(
        source,
        '''\t\t\tif err != nil {\n\t\t\t\tslog.Warn("failed to presign inline attachment URL", "id", uuidToString(att.ID), "key", key, "error", err)\n\t\t\t} else {''',
        '''\t\t\tif err != nil {\n\t\t\t\tslog.Warn("failed to presign inline attachment URL", "id", uuidToString(att.ID), "key", key, "error", err)\n\t\t\t\tif writeTaskFlowStorageError(w, err, http.StatusBadGateway, "private attachment preview is unavailable") {\n\t\t\t\t\treturn\n\t\t\t\t}\n\t\t\t} else {''',
        "inline signed URL failure must not return a misleading fallback",
    )
    source = replace_once(
        source,
        '''\t\t\tif dlURL, err := presigner.PresignGetWithContentDisposition(r.Context(), key, h.attachmentDownloadURLTTL(), storage.AttachmentContentDisposition(att.Filename)); err != nil {\n\t\t\t\tslog.Warn("failed to presign attachment download URL", "id", uuidToString(att.ID), "key", key, "error", err)\n\t\t\t} else {''',
        '''\t\t\tif dlURL, err := presigner.PresignGetWithContentDisposition(r.Context(), key, h.attachmentDownloadURLTTL(), storage.AttachmentContentDisposition(att.Filename)); err != nil {\n\t\t\t\tslog.Warn("failed to presign attachment download URL", "id", uuidToString(att.ID), "key", key, "error", err)\n\t\t\t\tif writeTaskFlowStorageError(w, err, http.StatusBadGateway, "private attachment download is unavailable") {\n\t\t\t\t\treturn\n\t\t\t\t}\n\t\t\t} else {''',
        "download signed URL failure must not return a misleading fallback",
    )
    source = replace_once(
        source,
        '''\t\tif err != nil {\n\t\t\tslog.Error("failed to presign attachment download", "id", uuidToString(att.ID), "key", key, "error", err)\n\t\t\twriteError(w, http.StatusBadGateway, "failed to create download URL")\n\t\t\treturn\n\t\t}''',
        '''\t\tif err != nil {\n\t\t\tslog.Error("failed to presign attachment download", "id", uuidToString(att.ID), "key", key, "error", err)\n\t\t\tif !writeTaskFlowStorageError(w, err, http.StatusBadGateway, "private attachment download is unavailable") {\n\t\t\t\twriteError(w, http.StatusBadGateway, "failed to create download URL")\n\t\t\t}\n\t\t\treturn\n\t\t}''',
        "download failure status mapping",
    )
    source = replace_once(
        source,
        '''\tif err != nil {\n\t\tslog.Error("failed to open attachment for preview", "id", attachmentID, "key", key, "error", err)\n\t\twriteError(w, http.StatusNotFound, "attachment object not found")\n\t\treturn\n\t}''',
        '''\tif err != nil {\n\t\tslog.Error("failed to open attachment for preview", "id", attachmentID, "key", key, "error", err)\n\t\tif !writeTaskFlowStorageError(w, err, http.StatusBadGateway, "private attachment preview is unavailable") {\n\t\t\twriteError(w, http.StatusNotFound, "attachment object not found")\n\t\t}\n\t\treturn\n\t}''',
        "preview storage error mapping",
    )
    return source


def patch_api_client(source: str) -> str:
    source = replace_once(
        source,
        '''    const buildHeaders = (): Record<string, string> => ({\n      "X-Request-ID": rid,\n      ...this.authHeaders(),\n      ...(init?.extraHeaders ?? {}),\n      ...((init?.headers as Record<string, string>) ?? {}),\n    });''',
        '''    const buildHeaders = (): Record<string, string> => ({\n      "X-Request-ID": rid,\n      ...this.authHeaders(),\n      ...(init?.extraHeaders ?? {}),\n      ...((init?.headers as Record<string, string>) ?? {}),\n      ...this.taskFlowStorageHeaders(path),\n    });''',
        "scoped storage token header for attachment API only",
    )
    source = replace_once(
        source,
        '''  private handleUnauthorized(credentialUsed: string | null) {\n    if (credentialUsed !== null && this.getToken() !== credentialUsed) {''',
        '''  private clearTaskFlowStorageToken() {\n    if (typeof window === "undefined") return;\n    try { window.sessionStorage.removeItem("zhuge_storage_access_token"); } catch { /* storage can be unavailable in hardened browsers */ }\n  }\n\n  private taskFlowStorageHeaders(path: string): Record<string, string> {\n    const pathname = path.split(/[?#]/, 1)[0] ?? path;\n    const attachmentRoute = pathname === "/api/upload-file"\n      || /^\\/api\\/attachments\\/[^/]+(?:\\/(?:content|download))?$/.test(pathname);\n    if (!attachmentRoute || typeof window === "undefined") return {};\n    try {\n      const token = window.sessionStorage.getItem("zhuge_storage_access_token")?.trim();\n      return token ? { "X-Zhuge-Storage-Token": token } : {};\n    } catch {\n      return {};\n    }\n  }\n\n  private handleUnauthorized(credentialUsed: string | null) {\n    if (credentialUsed !== null && this.getToken() !== credentialUsed) {''',
        "scoped credential client helpers",
    )
    source = replace_once(
        source,
        '''    this.token = null;\n    // Workspace id is owned by the URL-driven workspace-storage singleton''',
        '''    this.token = null;\n    this.clearTaskFlowStorageToken();\n    // Workspace id is owned by the URL-driven workspace-storage singleton''',
        "clear Storage token when TaskFlow session expires",
    )
    source = replace_once(
        source,
        '''  async logout(): Promise<void> {\n    await this.fetch("/auth/logout", { method: "POST" });\n  }''',
        '''  async logout(): Promise<void> {\n    try {\n      await this.fetch("/auth/logout", { method: "POST" });\n    } finally {\n      this.clearTaskFlowStorageToken();\n    }\n  }''',
        "clear Storage token on explicit logout",
    )
    source = replace_once(
        source,
        '''    const res = await fetch(`${this.baseUrl}/api/upload-file`, {\n      method: "POST",\n      headers: this.authHeaders(),\n      body: formData,''',
        '''    const res = await fetch(`${this.baseUrl}/api/upload-file`, {\n      method: "POST",\n      headers: { ...this.authHeaders(), ...this.taskFlowStorageHeaders("/api/upload-file") },\n      body: formData,''',
        "upload bearer header",
    )
    return source


def patch_handoff(source: str) -> str:
    required = (
        'const storageToken = params.get("zhuge_storage_token") || "";',
        'window.sessionStorage.setItem("zhuge_storage_access_token", storageToken);',
        'window.sessionStorage.removeItem("zhuge_storage_access_token")',
        'window.history.replaceState(null, "", window.location.pathname + window.location.search);',
    )
    for marker in required:
        if source.count(marker) != 1:
            raise ValueError(f"TaskFlow Handoff Storage credential contract: expected one marker {marker!r}, found {source.count(marker)}")
    if source.index(required[3]) > source.index(required[0]):
        raise ValueError("TaskFlow Handoff must clear the credential fragment before reading token values")
    return source


def copy_overlay(overlays: Path, root: Path) -> None:
    copies = {
        "taskflow_supabase_storage.go": "server/internal/storage/taskflow_supabase_storage.go",
        "taskflow_scoped_storage.go": "server/internal/storage/taskflow_scoped_storage.go",
        "taskflow_supabase_identity.go": "server/internal/storage/taskflow_supabase_identity.go",
        "taskflow_supabase_storage_test.go": "server/internal/storage/taskflow_supabase_storage_test.go",
        "taskflow_scoped_storage_test.go": "server/internal/storage/taskflow_scoped_storage_test.go",
        "taskflow_supabase_identity_test.go": "server/internal/storage/taskflow_supabase_identity_test.go",
        "taskflow_storage_identity_middleware.go": "server/internal/middleware/taskflow_storage_identity.go",
        "taskflow_storage_identity_middleware_test.go": "server/internal/middleware/taskflow_storage_identity_test.go",
        "taskflow_supabase_storage_handler.go": "server/internal/handler/taskflow_supabase_storage.go",
        "taskflow_supabase_storage_handler_test.go": "server/internal/handler/taskflow_supabase_storage_handler_test.go",
    }
    for source_name, target_name in copies.items():
        source = overlays / source_name
        target = root / target_name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)


def apply_backend(root: Path, overlays: Path) -> None:
    copy_overlay(overlays, root)
    router = root / "server/cmd/server/router.go"
    router.write_text(patch_router(router.read_text()))
    file_handler = root / "server/internal/handler/file.go"
    file_handler.write_text(patch_file_handler(file_handler.read_text()))


def patch_web_upload_limit(root: Path) -> None:
    # Keep the native upload UX while respecting Supabase Free's decimal 50 MB
    # cap. All changes are staged under /src; frozen vendor stays unchanged.
    edits = (
        ("packages/core/constants/upload.ts",
         "export const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB",
         "export const MAX_FILE_SIZE = 50_000_000; // Supabase Free: 50 MB"),
        ("packages/core/hooks/use-file-upload.ts",
         "File exceeds 100 MB limit", "File exceeds 50 MB limit"),
        ("packages/core/hooks/use-file-upload.test.ts",
         "/100 MB/", "/50 MB/"),
        ("packages/views/editor/use-coordinated-uploads.ts",
         "File exceeds 100 MB limit", "File exceeds 50 MB limit"),
        ("packages/views/editor/use-editor-upload.test.tsx",
         "File exceeds 100 MB limit", "File exceeds 50 MB limit"),
    )
    for relative, before, after in edits:
        filename = root / relative
        filename.write_text(
            replace_once(filename.read_text(), before, after, relative)
        )


def apply_web(root: Path, overlays: Path) -> None:
    patch_web_upload_limit(root)
    client = root / "packages/core/api/client.ts"
    client.write_text(patch_api_client(client.read_text()))
    handoff = root / "apps/web/public/zhuge-handoff.html"
    handoff.write_text(patch_handoff(handoff.read_text()))
    client_test = root / "packages/core/api/taskflow_supabase_storage_client.test.ts"
    shutil.copy2(overlays / "taskflow_supabase_storage_client.test.ts", client_test)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=("backend", "web"), required=True)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--overlays", type=Path, required=True)
    args = parser.parse_args()
    root = args.root.resolve()
    overlays = args.overlays.resolve()
    if args.target == "backend":
        apply_backend(root, overlays)
    else:
        apply_web(root, overlays)


if __name__ == "__main__":
    main()

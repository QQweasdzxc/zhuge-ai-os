#!/usr/bin/env python3
"""Upload a verified TaskFlow schema dump directly to the approved Drive folder.

Production authentication is a short-lived Google access token minted from the
protected GitHub Environment's OIDC identity. No Google credential file, bearer
token, database dump, or upload response body is printed or retained in GitHub
artifacts. The test mode accepts only a loopback HTTP mock server.
"""
from __future__ import annotations

import hashlib
import http.client
import json
import os
import re
import sys
import datetime
import urllib.parse
from pathlib import Path


FOLDER_ID = "1426lDVU97bSseRVzMLRMzh1C2eAIZ-xU"
DEFAULT_API_BASE = "https://www.googleapis.com/drive/v3"
CHUNK_SIZE = 8 * 1024 * 1024  # multiple of Drive's 256 KiB resumable chunk unit
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
SERVICE_ACCOUNT_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.iam\.gserviceaccount\.com$")
DRIVE_SCOPE = "https://www.googleapis.com/auth/drive"


class DriveUploadError(RuntimeError):
    pass


class GoogleTokenProvider:
    """Refresh short-lived GitHub OIDC/WIF credentials without a key file."""

    def __init__(self, expected_account: str):
        try:
            import google.auth
            from google.auth.transport.requests import Request

            credentials, _ = google.auth.default(scopes=[DRIVE_SCOPE])
            account = str(getattr(credentials, "service_account_email", "")).casefold()
            if account and account != expected_account.casefold():
                raise DriveUploadError("workload_identity_service_account_mismatch")
            self.credentials = credentials
            self.request = Request()
        except DriveUploadError:
            raise
        except Exception:
            raise DriveUploadError("workload_identity_credentials_unavailable") from None

    def get(self) -> str:
        try:
            expiry = getattr(self.credentials, "expiry", None)
            refresh_window = datetime.datetime.now(expiry.tzinfo or datetime.timezone.utc) + datetime.timedelta(seconds=90) if expiry else None
            if not self.credentials.valid or (expiry is not None and expiry <= refresh_window):
                self.credentials.refresh(self.request)
            token = str(self.credentials.token or "")
            if not token or "\n" in token or "\r" in token:
                raise DriveUploadError("workload_identity_token_unavailable")
            return token
        except DriveUploadError:
            raise
        except Exception:
            raise DriveUploadError("workload_identity_token_refresh_failed") from None


def _fail(stage: str) -> None:
    print(f"TASKFLOW_DRIVE_UPLOAD_FAILED stage={stage}", file=sys.stderr)
    raise SystemExit(1)


def _api_base() -> str:
    base = os.environ.get("TASKFLOW_BACKUP_DRIVE_API_BASE", DEFAULT_API_BASE).rstrip("/")
    parsed = urllib.parse.urlsplit(base)
    test_mode = os.environ.get("TASKFLOW_BACKUP_DRIVE_TEST_MODE") == "1"
    if test_mode:
        if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"}:
            raise DriveUploadError("invalid_test_api_origin")
    elif parsed.scheme != "https" or parsed.hostname != "www.googleapis.com":
        raise DriveUploadError("invalid_google_api_origin")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise DriveUploadError("invalid_api_base")
    return base


def _upload_base(api_base: str) -> str:
    parsed = urllib.parse.urlsplit(api_base)
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, "/upload/drive/v3", "", ""))


def _validate_url(url: str, expected_origin: str) -> urllib.parse.SplitResult:
    parsed = urllib.parse.urlsplit(url)
    expected = urllib.parse.urlsplit(expected_origin)
    if (parsed.scheme, parsed.hostname, parsed.port) != (expected.scheme, expected.hostname, expected.port):
        raise DriveUploadError("unexpected_drive_upload_origin")
    expected_path = expected.path.rstrip("/")
    if (parsed.username or parsed.password or not parsed.path.startswith(expected_path + "/")
            or parsed.fragment):
        raise DriveUploadError("invalid_drive_upload_url")
    if not os.environ.get("TASKFLOW_BACKUP_DRIVE_TEST_MODE") and parsed.hostname != "www.googleapis.com":
        raise DriveUploadError("unexpected_google_api_host")
    return parsed


def _request(method: str, url: str, token: str | GoogleTokenProvider, headers: dict[str, str] | None = None,
             body: bytes | None = None, *, stream_to_hash: bool = False):
    parsed = urllib.parse.urlsplit(url)
    test_mode = os.environ.get("TASKFLOW_BACKUP_DRIVE_TEST_MODE") == "1"
    if test_mode:
        if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"}:
            raise DriveUploadError("invalid_test_request_origin")
        connection = http.client.HTTPConnection(parsed.hostname, parsed.port, timeout=60)
    else:
        if parsed.scheme != "https" or parsed.hostname != "www.googleapis.com":
            raise DriveUploadError("invalid_google_request_origin")
        connection = http.client.HTTPSConnection(parsed.hostname, parsed.port or 443, timeout=60)
    target = urllib.parse.urlunsplit(("", "", parsed.path, parsed.query, ""))
    token_value = token.get() if isinstance(token, GoogleTokenProvider) else token
    request_headers = {"Authorization": f"Bearer {token_value}", **(headers or {})}
    try:
        connection.request(method, target, body=body, headers=request_headers)
        response = connection.getresponse()
        response_headers = {key.lower(): value for key, value in response.getheaders()}
        if stream_to_hash:
            digest = hashlib.sha256()
            byte_count = 0
            while True:
                block = response.read(CHUNK_SIZE)
                if not block:
                    break
                digest.update(block)
                byte_count += len(block)
            response_body = b""
            response_hash = digest.hexdigest()
        else:
            response_body = response.read(1024 * 1024 + 1)
            if len(response_body) > 1024 * 1024:
                raise DriveUploadError("drive_response_too_large")
            byte_count = 0
            response_hash = ""
        status = response.status
        connection.close()
        return status, response_headers, response_body, byte_count, response_hash
    except DriveUploadError:
        connection.close()
        raise
    except Exception:
        connection.close()
        raise DriveUploadError("drive_transport_failed") from None


def _json_request(method: str, url: str, token: str, *, body: dict | None = None,
                  expected: tuple[int, ...] = (200,)) -> dict:
    encoded = None if body is None else json.dumps(body, separators=(",", ":")).encode("utf-8")
    headers = {"Accept": "application/json"}
    if encoded is not None:
        headers["Content-Type"] = "application/json; charset=UTF-8"
    status, _, response, _, _ = _request(method, url, token, headers, encoded)
    if status not in expected:
        raise DriveUploadError(f"drive_http_{status}")
    try:
        return json.loads(response.decode("utf-8"))
    except Exception:
        raise DriveUploadError("invalid_drive_json") from None


def _token_and_account() -> tuple[str | GoogleTokenProvider, str]:
    account = os.environ.get("TASKFLOW_BACKUP_DRIVE_SERVICE_ACCOUNT", "")
    if not SERVICE_ACCOUNT_RE.fullmatch(account):
        raise DriveUploadError("invalid_expected_service_account")
    if os.environ.get("TASKFLOW_BACKUP_DRIVE_TEST_MODE") == "1":
        token = os.environ.get("TASKFLOW_BACKUP_DRIVE_ACCESS_TOKEN", "")
        if not token or "\n" in token or "\r" in token:
            raise DriveUploadError("missing_test_access_token")
        return token, account.casefold()
    return GoogleTokenProvider(account), account.casefold()


def _get_folder(api_base: str, token: str) -> dict:
    fields = urllib.parse.quote("id,mimeType,driveId,capabilities(canAddChildren),permissions(type,role,emailAddress,domain,deleted)", safe="(),")
    url = f"{api_base}/files/{FOLDER_ID}?supportsAllDrives=true&fields={fields}"
    folder = _json_request("GET", url, token)
    if folder.get("id") != FOLDER_ID or folder.get("mimeType") != "application/vnd.google-apps.folder":
        raise DriveUploadError("unexpected_backup_folder")
    # Google service accounts cannot own My Drive files and have no My Drive
    # storage quota. Require a Shared Drive before any production DB read.
    if not folder.get("driveId"):
        raise DriveUploadError("service_account_requires_shared_drive")
    if folder.get("capabilities", {}).get("canAddChildren") is not True:
        raise DriveUploadError("drive_folder_not_writable")
    account = os.environ.get("TASKFLOW_BACKUP_DRIVE_SERVICE_ACCOUNT", "").casefold()
    permissions = [p for p in folder.get("permissions", []) if p.get("deleted") is not True]
    uploaders = [p for p in permissions if p.get("type") == "user" and
                 str(p.get("emailAddress", "")).casefold() == account]
    if len(uploaders) != 1 or uploaders[0].get("role") != "writer":
        raise DriveUploadError("drive_folder_acl_not_exact")
    if len(permissions) != 1:
        raise DriveUploadError("drive_folder_has_unexpected_principal")
    return folder


def _verify_drive_actor(api_base: str, token: str | GoogleTokenProvider, expected_account: str) -> None:
    fields = urllib.parse.quote("user(emailAddress)", safe="(),")
    actor = _json_request("GET", f"{api_base}/about?fields={fields}", token)
    email = str(actor.get("user", {}).get("emailAddress", "")).casefold()
    if email != expected_account.casefold():
        raise DriveUploadError("drive_authenticated_principal_mismatch")


def check_target() -> None:
    api_base = _api_base()
    token, account = _token_and_account()
    _verify_drive_actor(api_base, token, account)
    _get_folder(api_base, token)
    print("TASKFLOW_DRIVE_TARGET_PASS folder=approved_private service_account_acl=restricted")


def _safe_file(path_text: str, runner_temp: Path) -> Path:
    candidate = Path(path_text)
    if candidate.is_symlink() or not candidate.is_file():
        raise DriveUploadError("backup_file_not_regular")
    path = candidate.resolve(strict=True)
    root = runner_temp.resolve(strict=True)
    if os.path.commonpath((str(root), str(path))) != str(root):
        raise DriveUploadError("backup_file_outside_runner_temp")
    if path.stat().st_mode & 0o077:
        raise DriveUploadError("backup_file_permissions_too_open")
    return path


def _file_sha256(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(CHUNK_SIZE)
            if not chunk:
                break
            size += len(chunk)
            digest.update(chunk)
    return digest.hexdigest(), size


def _find_existing(api_base: str, token: str, name: str) -> list[dict]:
    query = f"'{FOLDER_ID}' in parents and name = '{name}' and trashed = false"
    params = urllib.parse.urlencode({"q": query, "spaces": "drive", "pageSize": "10",
                                     "supportsAllDrives": "true", "includeItemsFromAllDrives": "true",
                                     "fields": "files(id,name,size,mimeType,parents,md5Checksum)"})
    payload = _json_request("GET", f"{api_base}/files?{params}", token)
    return payload.get("files", [])


def _download_bytes(api_base: str, token: str | GoogleTokenProvider, file_id: str,
                    *, limit: int = 1024 * 1024) -> bytes:
    url = f"{api_base}/files/{urllib.parse.quote(file_id, safe='')}?alt=media&supportsAllDrives=true"
    status, _, response, _, _ = _request("GET", url, token, stream_to_hash=False)
    if status != 200 or len(response) > limit:
        raise DriveUploadError("drive_readback_content_invalid")
    return response


def _hash_remote(api_base: str, token: str, file_id: str) -> tuple[str, int]:
    url = f"{api_base}/files/{urllib.parse.quote(file_id, safe='')}?alt=media&supportsAllDrives=true"
    status, _, _, size, digest = _request("GET", url, token, stream_to_hash=True)
    if status != 200:
        raise DriveUploadError(f"drive_readback_http_{status}")
    return digest, size


def verify_candidate_backup() -> None:
    api_base = _api_base()
    token, account = _token_and_account()
    _verify_drive_actor(api_base, token, account)
    _get_folder(api_base, token)
    source_sha = os.environ.get("GITHUB_SHA", "")
    version = os.environ.get("CANDIDATE_VERSION", "")
    build = os.environ.get("CANDIDATE_BUILD", "")
    if not re.fullmatch(r"[0-9a-f]{40}", source_sha) or not version or not build:
        raise DriveUploadError("candidate_identity_missing")

    query = f"'{FOLDER_ID}' in parents and name contains 'taskflow-schema-{source_sha}' and trashed = false"
    params = urllib.parse.urlencode({"q": query, "spaces": "drive", "pageSize": "100",
                                     "supportsAllDrives": "true", "includeItemsFromAllDrives": "true",
                                     "fields": "files(id,name,size,mimeType,parents,md5Checksum)"})
    entries = _json_request("GET", f"{api_base}/files?{params}", token).get("files", [])
    manifests = [entry for entry in entries if entry.get("name", "").endswith(".manifest.json")]
    if not manifests:
        raise DriveUploadError("matching_drive_backup_not_found")

    verified = False
    for entry in manifests:
        try:
            metadata = entry
            manifest = json.loads(_download_bytes(api_base, token, metadata["id"]).decode("utf-8"))
            if (manifest.get("source_sha") != source_sha or
                    manifest.get("candidate_version") != version or
                    manifest.get("candidate_build") != build or
                    manifest.get("project_id") != "lenpbbhwxyyfwgvjcozf" or
                    manifest.get("scope") != "taskflow schema only; not a full Supabase project/database backup" or
                    manifest.get("source_identity_verified") is not True or
                    manifest.get("tls_verify_full") is not True or
                    manifest.get("application_layer_encryption") != "none; PM-approved" or
                    manifest.get("isolated_postgres_17_restore") != "PASS" or
                    manifest.get("table_row_counts_match") != "PASS" or
                    manifest.get("normalized_taskflow_schema_dump_match") != "PASS"):
                continue
            stem = metadata["name"][:-len(".manifest.json")]
            expected_dump = stem + ".dump"
            expected_checksum = expected_dump + ".sha256"
            if manifest.get("backup_file") != expected_dump:
                continue
            dump_entries = [item for item in entries if item.get("name") == expected_dump]
            checksum_entries = [item for item in entries if item.get("name") == expected_checksum]
            if len(dump_entries) != 1 or len(checksum_entries) != 1:
                continue
            dump_entry = dump_entries[0]
            checksum_entry = checksum_entries[0]
            expected_sha = manifest.get("backup_sha256", "")
            expected_size = manifest.get("backup_bytes")
            if not SHA256_RE.fullmatch(expected_sha) or not isinstance(expected_size, int):
                continue
            checksum_text = _download_bytes(api_base, token, checksum_entry["id"]).decode("utf-8").strip().split()
            if len(checksum_text) != 2 or checksum_text != [expected_sha, expected_dump]:
                continue
            _verify_metadata(api_base, token, dump_entry["id"], expected_dump,
                             expected_size, "application/octet-stream")
            remote_sha, remote_size = _hash_remote(api_base, token, dump_entry["id"])
            if remote_sha != expected_sha or remote_size != expected_size:
                continue
            verified = True
            break
        except (KeyError, ValueError, UnicodeDecodeError, DriveUploadError):
            continue
    if not verified:
        raise DriveUploadError("matching_drive_backup_failed_integrity_gate")
    print("TASKFLOW_DRIVE_BACKUP_PRECONDITION_PASS exact_candidate_sha=verified scope=taskflow_schema_only restore=PASS readback_sha256=PASS")


def _verify_metadata(api_base: str, token: str, file_id: str, name: str,
                     expected_size: int, mime_type: str) -> None:
    fields = urllib.parse.quote("id,name,size,mimeType,parents", safe=",()")
    url = f"{api_base}/files/{urllib.parse.quote(file_id, safe='')}?supportsAllDrives=true&fields={fields}"
    item = _json_request("GET", url, token)
    if (item.get("id") != file_id or item.get("name") != name or
            int(item.get("size", -1)) != expected_size or item.get("mimeType") != mime_type or
            item.get("parents") != [FOLDER_ID]):
        raise DriveUploadError("drive_metadata_readback_mismatch")


def _create_upload_session(upload_base: str, api_base: str, token: str, name: str,
                           size: int, mime_type: str) -> str:
    metadata = {"name": name, "mimeType": mime_type, "parents": [FOLDER_ID]}
    encoded = json.dumps(metadata, separators=(",", ":")).encode("utf-8")
    url = f"{upload_base}/files?uploadType=resumable&supportsAllDrives=true"
    headers = {"Content-Type": "application/json; charset=UTF-8",
               "X-Upload-Content-Type": mime_type,
               "X-Upload-Content-Length": str(size)}
    status, response_headers, body, _, _ = _request("POST", url, token, headers, encoded)
    if status not in (200, 201):
        raise DriveUploadError(f"drive_session_http_{status}")
    location = response_headers.get("location")
    if not location:
        raise DriveUploadError("drive_session_location_missing")
    _validate_url(location, upload_base)
    if not body:
        return location
    try:
        json.loads(body.decode("utf-8"))
    except Exception:
        raise DriveUploadError("invalid_drive_session_response") from None
    return location


def _upload_resumable(upload_base: str, api_base: str, token: str, path: Path,
                      name: str, mime_type: str, expected_sha: str, size: int) -> str:
    location = _create_upload_session(upload_base, api_base, token, name, size, mime_type)
    final = None
    offset = 0
    with path.open("rb") as handle:
        while offset < size:
            block = handle.read(min(CHUNK_SIZE, size - offset))
            if not block:
                raise DriveUploadError("backup_changed_during_upload")
            end = offset + len(block) - 1
            headers = {"Content-Type": mime_type,
                       "Content-Range": f"bytes {offset}-{end}/{size}"}
            status, response_headers, body, _, _ = _request("PUT", location, token, headers, block)
            if end + 1 < size:
                if status != 308:
                    raise DriveUploadError(f"drive_chunk_http_{status}")
                received = response_headers.get("range", "")
                match = re.fullmatch(r"bytes=0-(\d+)", received)
                if not match or int(match.group(1)) + 1 != end + 1:
                    raise DriveUploadError("drive_chunk_range_mismatch")
                offset = end + 1
                continue
            if status not in (200, 201):
                raise DriveUploadError(f"drive_finalize_http_{status}")
            try:
                final = json.loads(body.decode("utf-8"))
            except Exception:
                raise DriveUploadError("invalid_drive_finalize_response") from None
            offset = end + 1
    if final is None or not isinstance(final.get("id"), str):
        raise DriveUploadError("drive_file_id_missing")
    file_id = final["id"]
    _verify_metadata(api_base, token, file_id, name, size, mime_type)
    remote_sha, remote_size = _hash_remote(api_base, token, file_id)
    if remote_size != size or remote_sha != expected_sha:
        raise DriveUploadError("drive_sha256_readback_mismatch")
    return file_id


def _ensure_uploaded(api_base: str, upload_base: str, token: str, path: Path,
                     name: str, mime_type: str) -> str:
    expected_sha, expected_size = _file_sha256(path)
    existing = _find_existing(api_base, token, name)
    if len(existing) > 1:
        raise DriveUploadError("duplicate_named_drive_files")
    if existing:
        item = existing[0]
        file_id = item.get("id", "")
        if not file_id:
            raise DriveUploadError("existing_drive_file_id_missing")
        _verify_metadata(api_base, token, file_id, name, expected_size, mime_type)
        remote_sha, remote_size = _hash_remote(api_base, token, file_id)
        if remote_size != expected_size or remote_sha != expected_sha:
            raise DriveUploadError("existing_drive_file_sha256_mismatch")
        return file_id
    file_id = _upload_resumable(upload_base, api_base, token, path, name,
                                mime_type, expected_sha, expected_size)
    return file_id


def upload(paths: list[str]) -> None:
    api_base = _api_base()
    upload_base = _upload_base(api_base)
    token, account = _token_and_account()
    _verify_drive_actor(api_base, token, account)
    _get_folder(api_base, token)
    runner_temp = Path(os.environ.get("RUNNER_TEMP", "")).resolve(strict=True)
    safe_paths = [_safe_file(value, runner_temp) for value in paths]
    if len(safe_paths) != 3:
        raise DriveUploadError("expected_backup_checksum_and_manifest")
    dump, checksum, manifest = safe_paths
    expected_checksum, _ = _file_sha256(dump)
    run_id = os.environ.get("GITHUB_RUN_ID", "")
    attempt = os.environ.get("GITHUB_RUN_ATTEMPT", "")
    source_sha = os.environ.get("GITHUB_SHA", "")
    if not run_id.isdigit() or not attempt.isdigit() or not re.fullmatch(r"[0-9a-f]{40}", source_sha):
        raise DriveUploadError("workflow_run_identity_invalid")
    stem = f"taskflow-schema-{source_sha}-run{run_id}-attempt{attempt}"
    expected_drive_dump = f"{stem}.dump"
    checksum_text = checksum.read_text(encoding="utf-8").strip().split()
    if len(checksum_text) != 2 or checksum_text != [expected_checksum, expected_drive_dump]:
        raise DriveUploadError("local_backup_sha256_invalid")
    try:
        manifest_data = json.loads(manifest.read_text(encoding="utf-8"))
    except Exception:
        raise DriveUploadError("manifest_invalid") from None
    if (manifest_data.get("source_sha") != source_sha or
            manifest_data.get("backup_sha256") != expected_checksum or
            manifest_data.get("backup_file") != expected_drive_dump or
            manifest_data.get("backup_bytes") != dump.stat().st_size):
        raise DriveUploadError("manifest_identity_or_checksum_mismatch")
    if manifest_data.get("scope") != "taskflow schema only; not a full Supabase project/database backup":
        raise DriveUploadError("manifest_scope_invalid")

    files = [
        (dump, expected_drive_dump, "application/octet-stream"),
        (checksum, f"{expected_drive_dump}.sha256", "text/plain"),
        (manifest, f"{stem}.manifest.json", "application/json"),
    ]
    uploaded = []
    for path, name, mime_type in files:
        uploaded.append(_ensure_uploaded(api_base, upload_base, token, path, name, mime_type))
    _get_folder(api_base, token)
    print(f"TASKFLOW_BACKUP_DRIVE_READBACK_PASS scope=taskflow_schema_only sha256={expected_checksum} size={dump.stat().st_size}")
    print("TASKFLOW_BACKUP_FILES_STORED count=3 location=approved_drive_folder")


def main() -> None:
    try:
        if len(sys.argv) == 2 and sys.argv[1] == "--check-target-only":
            check_target()
            return
        if len(sys.argv) == 2 and sys.argv[1] == "--verify-candidate-backup":
            verify_candidate_backup()
            return
        if len(sys.argv) == 5 and sys.argv[1] == "--upload":
            upload(sys.argv[2:])
            return
        _fail("arguments")
    except DriveUploadError as error:
        _fail(str(error))


if __name__ == "__main__":
    main()

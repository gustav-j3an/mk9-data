#!/usr/bin/env python3
"""Upload age-encrypted MK9 backup files to a private Google Drive folder."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

TOKEN_URL = "https://oauth2.googleapis.com/token"
API_BASE = "https://www.googleapis.com/drive/v3"
UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3"
DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file"
DEFAULT_FOLDER_NAME = "MK9 DATE Production Backups"
CHUNK_SIZE = 8 * 1024 * 1024  # multiple of Drive's 256 KiB resumable-upload granularity
MAX_RETRIES = 5


class BackupError(Exception):
    """An error safe to report without leaking credentials or resumable URLs."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


OPENER = urllib.request.build_opener(NoRedirect)


def _urlopen(request: urllib.request.Request, timeout: int = 60):
    try:
        return OPENER.open(request, timeout=timeout)
    except urllib.error.HTTPError as exc:
        return exc


def _json_response(response) -> tuple[int, dict, object]:
    status = response.getcode()
    headers = response.headers
    raw = response.read()
    if status >= 400:
        raise BackupError("DRIVE_API_REQUEST_FAILED")
    try:
        data = json.loads(raw.decode("utf-8")) if raw else {}
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BackupError("DRIVE_API_RESPONSE_INVALID") from exc
    return status, data, headers


def _credentials() -> tuple[str, str, str]:
    client_id = os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "")
    client_secret = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET", "")
    refresh_token = os.environ.get("GOOGLE_OAUTH_REFRESH_TOKEN", "")
    if not all((client_id, client_secret, refresh_token)):
        raise BackupError("GOOGLE_DRIVE_OAUTH_SECRETS_MISSING")
    return client_id, client_secret, refresh_token


def get_access_token() -> str:
    client_id, client_secret, refresh_token = _credentials()
    body = urllib.parse.urlencode({
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
        "scope": DRIVE_FILE_SCOPE,
    }).encode("ascii")
    request = urllib.request.Request(
        TOKEN_URL,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    response = _urlopen(request)
    _, data, _ = _json_response(response)
    token = data.get("access_token")
    if not isinstance(token, str) or not token:
        raise BackupError("GOOGLE_DRIVE_ACCESS_TOKEN_NOT_ISSUED")
    granted_scopes = data.get("scope")
    if granted_scopes and DRIVE_FILE_SCOPE not in granted_scopes.split():
        raise BackupError("GOOGLE_DRIVE_SCOPE_MISMATCH")
    return token


def _api_request(method: str, url: str, token: str, *, body: bytes | None = None,
                 headers: dict[str, str] | None = None, timeout: int = 60):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname not in {
        "www.googleapis.com", "oauth2.googleapis.com"
    }:
        raise BackupError("GOOGLE_DRIVE_ENDPOINT_REJECTED")
    request_headers = {"Authorization": f"Bearer {token}"}
    if headers:
        request_headers.update(headers)
    request = urllib.request.Request(url, data=body, headers=request_headers, method=method)
    return _urlopen(request, timeout=timeout)


def _api_json(method: str, url: str, token: str, body: dict | None = None,
              headers: dict[str, str] | None = None) -> tuple[int, dict, object]:
    request_headers = {"Accept": "application/json"}
    raw = None
    if body is not None:
        raw = json.dumps(body, separators=(",", ":")).encode("utf-8")
        request_headers["Content-Type"] = "application/json; charset=UTF-8"
    if headers:
        request_headers.update(headers)
    return _json_response(_api_request(method, url, token, body=raw, headers=request_headers))


def _folder_name() -> str:
    name = (os.environ.get("GOOGLE_DRIVE_BACKUP_FOLDER_NAME") or DEFAULT_FOLDER_NAME).strip()
    if not name or len(name) > 100 or any(ord(char) < 32 for char in name):
        raise BackupError("GOOGLE_DRIVE_FOLDER_NAME_INVALID")
    return name


def _assert_private(item: dict) -> None:
    if item.get("shared") is True:
        raise BackupError("GOOGLE_DRIVE_DESTINATION_IS_SHARED")
    for permission in item.get("permissions", []):
        if permission.get("type") in {"anyone", "domain"}:
            raise BackupError("GOOGLE_DRIVE_DESTINATION_IS_PUBLIC_OR_DOMAIN_SHARED")


def ensure_private_folder(token: str) -> str:
    name = _folder_name()
    query = "name='" + name.replace("\\", "\\\\").replace("'", "\\'") + "' and mimeType='application/vnd.google-apps.folder' and trashed=false"
    fields = "files(id,name,mimeType,shared,permissions(type,role))"
    params = urllib.parse.urlencode({"q": query, "pageSize": "100", "fields": fields})
    _, listing, _ = _api_json("GET", f"{API_BASE}/files?{params}", token)
    folders = listing.get("files", [])
    if len(folders) > 1:
        raise BackupError("GOOGLE_DRIVE_BACKUP_FOLDER_AMBIGUOUS")
    if folders:
        folder = folders[0]
        if folder.get("mimeType") != "application/vnd.google-apps.folder":
            raise BackupError("GOOGLE_DRIVE_BACKUP_FOLDER_TYPE_INVALID")
    else:
        folder_body = {
            "name": name,
            "mimeType": "application/vnd.google-apps.folder",
        }
        created_fields = "id,name,mimeType,shared,permissions(type,role)"
        create_url = f"{API_BASE}/files?{urllib.parse.urlencode({'fields': created_fields})}"
        _, folder, _ = _api_json("POST", create_url, token, folder_body)
        if not folder.get("id") or folder.get("name") != name:
            raise BackupError("GOOGLE_DRIVE_BACKUP_FOLDER_CREATE_FAILED")
    _assert_private(folder)
    return folder["id"]


def _fingerprints(file_path: Path) -> tuple[int, str, str]:
    size = 0
    sha256 = hashlib.sha256()
    md5 = hashlib.md5(usedforsecurity=False)
    with file_path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            size += len(chunk)
            sha256.update(chunk)
            md5.update(chunk)
    return size, sha256.hexdigest(), md5.hexdigest()


def _drive_session_url(location: str) -> str:
    parsed = urllib.parse.urlsplit(location)
    if (parsed.scheme != "https" or parsed.hostname != "www.googleapis.com"
            or not parsed.path.startswith("/upload/drive/v3/files")
            or not urllib.parse.parse_qs(parsed.query).get("upload_id")):
        raise BackupError("GOOGLE_DRIVE_UPLOAD_SESSION_URL_REJECTED")
    return location


def _offset_from_range(value: str | None) -> int:
    if not value:
        return 0
    match = re.fullmatch(r"bytes=0-(\d+)", value.strip())
    if not match:
        raise BackupError("GOOGLE_DRIVE_UPLOAD_RANGE_INVALID")
    return int(match.group(1)) + 1


def _query_upload_session(session_url: str, token: str, total: int):
    for attempt in range(MAX_RETRIES):
        response = _api_request("PUT", session_url, token, body=b"", headers={
            "Content-Length": "0",
            "Content-Range": f"bytes */{total}",
        }, timeout=120)
        status = response.getcode()
        if status in (200, 201):
            try:
                return total, json.loads(response.read().decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise BackupError("GOOGLE_DRIVE_UPLOAD_RESPONSE_INVALID") from exc
        if status == 308:
            return _offset_from_range(response.headers.get("Range")), None
        if status >= 500 and attempt + 1 < MAX_RETRIES:
            time.sleep(min(2 ** attempt, 16))
            continue
        raise BackupError("GOOGLE_DRIVE_UPLOAD_STATUS_FAILED")
    raise BackupError("GOOGLE_DRIVE_UPLOAD_RETRY_LIMIT")


def _upload_resumable(file_path: Path, token: str, folder_id: str, file_name: str,
                      run_id: str, size: int, sha256: str):
    metadata = {
        "name": file_name,
        "mimeType": "application/octet-stream",
        "parents": [folder_id],
        "appProperties": {"mk9Sha256": sha256, "mk9RunId": run_id[:100]},
    }
    fields = "id,name,size,mimeType,parents,shared,md5Checksum,appProperties,permissions(type,role)"
    start_url = f"{UPLOAD_BASE}/files?{urllib.parse.urlencode({'uploadType': 'resumable', 'fields': fields})}"
    body = json.dumps(metadata, separators=(",", ":")).encode("utf-8")
    start = _api_request("POST", start_url, token, body=body, headers={
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "application/octet-stream",
        "X-Upload-Content-Length": str(size),
    })
    if start.getcode() not in (200, 201):
        raise BackupError("GOOGLE_DRIVE_UPLOAD_SESSION_CREATE_FAILED")
    session_url = _drive_session_url(start.headers.get("Location", ""))
    offset = 0
    uploaded_file = None
    with file_path.open("rb") as stream:
        while offset < size:
            stream.seek(offset)
            chunk = stream.read(min(CHUNK_SIZE, size - offset))
            if not chunk:
                raise BackupError("GOOGLE_DRIVE_LOCAL_ARCHIVE_CHANGED")
            end = offset + len(chunk) - 1
            request = urllib.request.Request(session_url, data=chunk, headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/octet-stream",
                "Content-Length": str(len(chunk)),
                "Content-Range": f"bytes {offset}-{end}/{size}",
            }, method="PUT")
            try:
                response = _urlopen(request, timeout=180)
            except (TimeoutError, OSError):
                offset, uploaded_file = _query_upload_session(session_url, token, size)
                if uploaded_file:
                    break
                continue
            status = response.getcode()
            if status in (200, 201):
                try:
                    uploaded_file = json.loads(response.read().decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                    raise BackupError("GOOGLE_DRIVE_UPLOAD_RESPONSE_INVALID") from exc
                offset = size
            elif status == 308:
                new_offset = _offset_from_range(response.headers.get("Range"))
                if new_offset <= offset and new_offset != size:
                    raise BackupError("GOOGLE_DRIVE_UPLOAD_DID_NOT_ADVANCE")
                offset = new_offset
            elif status >= 500:
                offset, uploaded_file = _query_upload_session(session_url, token, size)
                if uploaded_file:
                    break
            else:
                raise BackupError("GOOGLE_DRIVE_UPLOAD_FAILED")
    if not uploaded_file or not uploaded_file.get("id"):
        raise BackupError("GOOGLE_DRIVE_UPLOAD_NOT_CONFIRMED")
    return uploaded_file


def _download_fingerprint(file_id: str, token: str) -> tuple[int, str]:
    url = f"{API_BASE}/files/{urllib.parse.quote(file_id, safe='')}?alt=media"
    response = _api_request("GET", url, token, timeout=180)
    if response.getcode() != 200:
        raise BackupError("GOOGLE_DRIVE_DOWNLOAD_VERIFICATION_FAILED")
    sha256 = hashlib.sha256()
    size = 0
    while chunk := response.read(1024 * 1024):
        size += len(chunk)
        sha256.update(chunk)
    return size, sha256.hexdigest()


def _verify_stored_file(file_path: Path, token: str, folder_id: str,
                        uploaded: dict, expected: tuple[int, str, str]) -> str:
    file_id = uploaded.get("id")
    if not isinstance(file_id, str) or not file_id:
        raise BackupError("GOOGLE_DRIVE_UPLOAD_NOT_CONFIRMED")
    fields = "id,name,size,md5Checksum,appProperties,parents,shared,permissions(type,role),trashed"
    url = f"{API_BASE}/files/{urllib.parse.quote(file_id, safe='')}?{urllib.parse.urlencode({'fields': fields})}"
    _, stored, _ = _api_json("GET", url, token)
    size, sha256, md5 = expected
    if stored.get("trashed") or str(stored.get("size")) != str(size):
        raise BackupError("GOOGLE_DRIVE_STORED_SIZE_MISMATCH")
    if stored.get("md5Checksum") != md5:
        raise BackupError("GOOGLE_DRIVE_STORED_CHECKSUM_MISMATCH")
    if stored.get("appProperties", {}).get("mk9Sha256") != sha256:
        raise BackupError("GOOGLE_DRIVE_STORED_SHA256_METADATA_MISMATCH")
    if folder_id not in stored.get("parents", []):
        raise BackupError("GOOGLE_DRIVE_STORED_PARENT_MISMATCH")
    _assert_private(stored)
    downloaded_size, downloaded_sha256 = _download_fingerprint(file_id, token)
    if downloaded_size != size or downloaded_sha256 != sha256:
        raise BackupError("GOOGLE_DRIVE_DOWNLOADED_SHA256_MISMATCH")
    if not file_path.is_file() or _fingerprints(file_path) != expected:
        raise BackupError("GOOGLE_DRIVE_LOCAL_ARCHIVE_CHANGED")
    return file_id


def preflight() -> None:
    token = get_access_token()
    ensure_private_folder(token)
    print("GOOGLE_DRIVE_PRIVATE_DESTINATION_READY")


def upload(file_path: Path, delete_after_verify: bool) -> None:
    if not file_path.is_file() or file_path.suffix != ".age":
        raise BackupError("ENCRYPTED_ARCHIVE_REQUIRED")
    expected = _fingerprints(file_path)
    size, sha256, _ = expected
    if size <= 0:
        raise BackupError("ENCRYPTED_ARCHIVE_EMPTY")
    token = get_access_token()
    folder_id = ensure_private_folder(token)
    run_id = os.environ.get("GITHUB_RUN_ID", "local")
    attempt = os.environ.get("GITHUB_RUN_ATTEMPT", "1")
    prefix = "mk9-drive-synthetic" if "synthetic" in file_path.name else "mk9-production-backup"
    file_name = f"{prefix}-{run_id}-{attempt}.tar.gz.age"
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,180}", file_name):
        raise BackupError("GOOGLE_DRIVE_BACKUP_FILE_NAME_INVALID")
    uploaded = _upload_resumable(file_path, token, folder_id, file_name, run_id, size, sha256)
    file_id = _verify_stored_file(file_path, token, folder_id, uploaded, expected)
    if delete_after_verify:
        _api_json("DELETE", f"{API_BASE}/files/{urllib.parse.quote(file_id, safe='')}", token)
        print(f"GOOGLE_DRIVE_SYNTHETIC_UPLOAD_VERIFIED_AND_DELETED bytes={size} sha256={sha256}")
    else:
        print(f"GOOGLE_DRIVE_BACKUP_STORED_AND_VERIFIED bytes={size} sha256={sha256}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("preflight")
    upload_parser = subparsers.add_parser("upload")
    upload_parser.add_argument("--file", required=True, type=Path)
    upload_parser.add_argument("--delete-after-verify", action="store_true")
    args = parser.parse_args(argv)
    try:
        if args.command == "preflight":
            preflight()
        else:
            upload(args.file, args.delete_after_verify)
    except BackupError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    except Exception:
        # Deliberately suppress exception details: urllib exceptions may embed URLs.
        print("GOOGLE_DRIVE_BACKUP_UNEXPECTED_FAILURE", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

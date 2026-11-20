import contextlib
import hashlib
import importlib.util
import io
import json
import os
import tempfile
import unittest
import urllib.parse
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).parents[1] / "scripts" / "mk9-drive-backup.py"
SPEC = importlib.util.spec_from_file_location("mk9_drive_backup", MODULE_PATH)
drive = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(drive)


class FakeResponse:
    def __init__(self, status, body=b"", headers=None):
        self.status = status
        self.body = body
        self.headers = headers or {}

    def getcode(self):
        return self.status

    def read(self, size=-1):
        if size is None or size < 0:
            data, self.body = self.body, b""
            return data
        data, self.body = self.body[:size], self.body[size:]
        return data


class FakeDriveAPI:
    def __init__(self, archive_bytes, corrupt_md5=False):
        self.archive_bytes = archive_bytes
        self.corrupt_md5 = corrupt_md5
        self.folder_id = "private-folder-id"
        self.file_id = "synthetic-file-id"
        self.folder_created = False
        self.upload_offset = 0
        self.uploaded = bytearray()
        self.deleted = False
        self.upload_metadata = None

    def open(self, request, timeout=60):
        url = request.full_url
        method = request.get_method()
        body = request.data or b""
        headers = {key.lower(): value for key, value in request.header_items()}
        if url == drive.TOKEN_URL and method == "POST":
            return FakeResponse(200, json.dumps({
                "access_token": "synthetic-access-token",
                "scope": drive.DRIVE_FILE_SCOPE,
            }).encode())
        if url.startswith(f"{drive.API_BASE}/files?") and method == "GET":
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
            if query.get("q"):
                files = []
                if self.folder_created:
                    files = [{
                        "id": self.folder_id,
                        "name": drive._folder_name(),
                        "mimeType": "application/vnd.google-apps.folder",
                        "shared": False,
                        "permissions": [{"type": "user", "role": "owner"}],
                    }]
                return FakeResponse(200, json.dumps({"files": files}).encode())
        if url.startswith(f"{drive.API_BASE}/files?") and method == "POST":
            self.folder_created = True
            return FakeResponse(200, json.dumps({
                "id": self.folder_id,
                "name": drive._folder_name(),
                "mimeType": "application/vnd.google-apps.folder",
                "shared": False,
                "permissions": [{"type": "user", "role": "owner"}],
            }).encode())
        if url.startswith(f"{drive.UPLOAD_BASE}/files?") and method == "POST":
            self.upload_metadata = json.loads(body)
            return FakeResponse(200, headers={
                "Location": f"{drive.UPLOAD_BASE}/files?uploadType=resumable&upload_id=synthetic-id"
            })
        if "upload_id=synthetic-id" in url and method == "PUT":
            if headers.get("content-range", "").startswith("bytes */"):
                return FakeResponse(308, headers={
                    "Range": f"bytes=0-{self.upload_offset - 1}" if self.upload_offset else ""
                })
            self.uploaded.extend(body)
            self.upload_offset = len(self.uploaded)
            total = int(headers["content-range"].rsplit("/", 1)[1])
            if self.upload_offset < total:
                return FakeResponse(308, headers={"Range": f"bytes=0-{self.upload_offset - 1}"})
            return FakeResponse(201, json.dumps({"id": self.file_id}).encode())
        if url.startswith(f"{drive.API_BASE}/files/{self.file_id}?") and method == "GET":
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
            if query.get("alt") == ["media"]:
                return FakeResponse(200, bytes(self.uploaded))
            return FakeResponse(200, json.dumps({
                "id": self.file_id,
                "name": self.upload_metadata["name"],
                "size": str(len(self.archive_bytes)),
                "md5Checksum": "bad-checksum" if self.corrupt_md5 else hashlib.md5(
                    self.archive_bytes, usedforsecurity=False
                ).hexdigest(),
                "appProperties": self.upload_metadata["appProperties"],
                "parents": [self.folder_id],
                "shared": False,
                "permissions": [{"type": "user", "role": "owner"}],
                "trashed": False,
            }).encode())
        if url == f"{drive.API_BASE}/files/{self.file_id}" and method == "DELETE":
            self.deleted = True
            return FakeResponse(204)
        raise AssertionError(f"Unexpected synthetic request: {method} {url}")


class DriveBackupTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {
            "GOOGLE_OAUTH_CLIENT_ID": "synthetic-client-id",
            "GOOGLE_OAUTH_CLIENT_SECRET": "synthetic-client-secret",
            "GOOGLE_OAUTH_REFRESH_TOKEN": "synthetic-refresh-token",
            "GOOGLE_DRIVE_BACKUP_FOLDER_NAME": drive.SYNTHETIC_FOLDER_NAME,
            "GITHUB_RUN_ID": "12345",
            "GITHUB_RUN_ATTEMPT": "1",
        })
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def test_synthetic_private_folder_is_created_and_reused(self):
        fake = FakeDriveAPI(b"unused")
        with patch.object(drive, "OPENER", fake):
            token = drive.get_access_token()
            folder_id = drive.ensure_private_folder(token)
            self.assertEqual(folder_id, fake.folder_id)
            self.assertEqual(drive.ensure_private_folder(token), fake.folder_id)
            self.assertTrue(fake.folder_created)

    def test_synthetic_archive_resumes_verifies_and_deletes(self):
        archive_bytes = (b"synthetic-encrypted-fixture-" * 5) + b"end"
        fake = FakeDriveAPI(archive_bytes)
        with tempfile.TemporaryDirectory() as temporary:
            archive = Path(temporary) / "synthetic-backup.tar.gz.age"
            archive.write_bytes(archive_bytes)
            output = io.StringIO()
            with patch.object(drive, "OPENER", fake), patch.object(drive, "CHUNK_SIZE", 16), \
                    contextlib.redirect_stdout(output):
                drive.upload(archive, synthetic_test=True)
            self.assertEqual(bytes(fake.uploaded), archive_bytes)
            self.assertTrue(fake.deleted)
            self.assertIn(hashlib.sha256(archive_bytes).hexdigest(), output.getvalue())
            self.assertNotIn("synthetic-access-token", output.getvalue())
            self.assertNotIn("upload_id", output.getvalue())

    def test_synthetic_archive_is_deleted_when_integrity_verification_fails(self):
        archive_bytes = b"synthetic-encrypted-fixture"
        fake = FakeDriveAPI(archive_bytes, corrupt_md5=True)
        with tempfile.TemporaryDirectory() as temporary:
            archive = Path(temporary) / "synthetic-backup.tar.gz.age"
            archive.write_bytes(archive_bytes)
            with patch.object(drive, "OPENER", fake), patch.object(drive, "CHUNK_SIZE", 16):
                with self.assertRaisesRegex(drive.BackupError, "CHECKSUM_MISMATCH"):
                    drive.upload(archive, synthetic_test=True)
            self.assertTrue(fake.deleted)

    def test_synthetic_mode_rejects_production_folder_before_authentication(self):
        os.environ["GOOGLE_DRIVE_BACKUP_FOLDER_NAME"] = drive.DEFAULT_FOLDER_NAME
        with tempfile.TemporaryDirectory() as temporary:
            archive = Path(temporary) / "synthetic-backup.tar.gz.age"
            archive.write_bytes(b"synthetic-ciphertext")
            with self.assertRaisesRegex(drive.BackupError, "FOLDER_MISMATCH"):
                drive.upload(archive, synthetic_test=True)

    def test_synthetic_cleanup_failure_is_reported_without_sensitive_details(self):
        archive_bytes = b"synthetic-encrypted-fixture"
        fake = FakeDriveAPI(archive_bytes, corrupt_md5=True)
        original_open = fake.open

        def fail_delete(request, timeout=60):
            if request.get_method() == "DELETE":
                raise OSError("synthetic failure containing a fake token")
            return original_open(request, timeout)

        with tempfile.TemporaryDirectory() as temporary:
            archive = Path(temporary) / "synthetic-backup.tar.gz.age"
            archive.write_bytes(archive_bytes)
            stderr = io.StringIO()
            with patch.object(drive, "OPENER", type("FakeOpener", (), {"open": staticmethod(fail_delete)})()), \
                    patch.object(drive, "CHUNK_SIZE", 16), contextlib.redirect_stderr(stderr):
                result = drive.main(["upload", "--synthetic-test", "--file", str(archive)])
            self.assertEqual(result, 1)
            self.assertIn("GOOGLE_DRIVE_SYNTHETIC_VERIFICATION_AND_CLEANUP_FAILED", stderr.getvalue())
            self.assertNotIn("fake token", stderr.getvalue())

    def test_shared_folder_is_rejected(self):
        with self.assertRaisesRegex(drive.BackupError, "IS_SHARED"):
            drive._assert_private({"shared": True, "permissions": []})


if __name__ == "__main__":
    unittest.main()

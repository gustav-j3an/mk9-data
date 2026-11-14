import re
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
DISPATCHER = (ROOT / ".github/workflows/supabase-production-backup.yml").read_text(encoding="utf-8")
TEST_WORKFLOW = (ROOT / ".github/workflows/m67-drive-backup-synthetic-test.yml").read_text(encoding="utf-8")
UPLOADER = (ROOT / "scripts/mk9-drive-backup.py").read_text(encoding="utf-8")


class DriveBackupWorkflowSecurityTests(unittest.TestCase):
    def test_existing_default_branch_workflow_dispatches_to_isolated_reusable_test(self):
        self.assertIn("workflow_dispatch:", DISPATCHER)
        self.assertIn("uses: ./.github/workflows/m67-drive-backup-synthetic-test.yml", DISPATCHER)
        self.assertIn("if: github.ref == 'refs/heads/codex/m67-google-drive-backup'", DISPATCHER)
        self.assertIn("github.ref == 'refs/heads/main'", DISPATCHER)

    def test_synthetic_workflow_uses_only_drive_and_age_secrets(self):
        secret_refs = set(re.findall(r"\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}", TEST_WORKFLOW))
        self.assertEqual(secret_refs, {
            "GOOGLE_OAUTH_CLIENT_ID",
            "GOOGLE_OAUTH_CLIENT_SECRET",
            "GOOGLE_OAUTH_REFRESH_TOKEN",
            "AGE_RECIPIENT",
        })
        self.assertNotIn("SUPABASE_DB_URL", TEST_WORKFLOW)
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", TEST_WORKFLOW)
        self.assertNotIn("VERCEL", TEST_WORKFLOW.upper())

    def test_synthetic_workflow_uses_only_approved_variables(self):
        variable_refs = set(re.findall(r"\$\{\{\s*vars\.([A-Z0-9_]+)\s*\}\}", TEST_WORKFLOW))
        self.assertEqual(variable_refs, {
            "APPROVED_DRIVE_TEST_COMMIT",
            "GOOGLE_DRIVE_BACKUP_FOLDER_NAME",
        })

    def test_synthetic_workflow_pins_branch_and_full_commit(self):
        self.assertIn("environment: drive-backup-test", TEST_WORKFLOW)
        self.assertIn("APPROVED_DRIVE_TEST_COMMIT", TEST_WORKFLOW)
        self.assertIn("=~ ^[0-9a-f]{40}$", TEST_WORKFLOW)
        self.assertIn('"$GITHUB_SHA" == "$APPROVED_DRIVE_TEST_COMMIT"', TEST_WORKFLOW)
        self.assertIn("refs/heads/codex/m67-google-drive-backup", TEST_WORKFLOW)

    def test_synthetic_workflow_has_no_public_artifact_or_production_folder(self):
        self.assertNotIn("upload-artifact", TEST_WORKFLOW)
        self.assertNotIn("MK9 DATE Production Backups", TEST_WORKFLOW)
        self.assertIn("MK9 DATE Synthetic Backup Tests", UPLOADER)
        self.assertIn("--synthetic-test", TEST_WORKFLOW)
        self.assertNotIn("--delete-after-verify", TEST_WORKFLOW)
        self.assertIn("if: always()", TEST_WORKFLOW)

    def test_production_secrets_remain_only_in_production_job(self):
        self.assertIn("environment: production-backup", DISPATCHER)
        self.assertIn("SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}", DISPATCHER)
        self.assertIn("SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}", DISPATCHER)
        self.assertNotIn("SUPABASE_DB_URL", TEST_WORKFLOW)
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", TEST_WORKFLOW)


if __name__ == "__main__":
    unittest.main()

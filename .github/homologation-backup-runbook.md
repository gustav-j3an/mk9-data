# Homologation backup workflow

The manual workflow is `.github/workflows/homologation-backup.yml`. It is read-only against Supabase. It does not run migrations, deploy, or use the locally linked Supabase project. The target project ref is fixed to `tafjceemuetqjyngresg` and the database URL is rejected unless it uses that project's IPv4 session pooler.

GitHub only allows `workflow_dispatch` when the workflow file exists on the default branch. This branch is not `main`; the workflow will become manually runnable after a separately reviewed merge. No merge or deployment is performed as part of this preparation.

## GitHub storage

The source repository is public, so this workflow never uploads a database file as a GitHub Actions artifact. Encrypted bundles are uploaded as prerelease assets to the private repository `gustav-j3an/mk9-date-homologation-backups`. Each asset is encrypted with age before upload; the release records ciphertext size and SHA-256. The private decryption identity is never written to the repository or release. That private repository currently contains no backup assets.

The release asset limit is 2 GiB per file. GitHub documents no aggregate release-asset size or bandwidth limit. Standard GitHub-hosted runners are free for public repositories. Current account billing usage could not be queried with the available GitHub connection, so the workflow remains manual and enforces the per-file limit before upload. It does not provision paid storage or another hosted service.

## Required GitHub Environment

After this workflow is merged to the default branch, create the Environment `homologation-backup`, restrict deployment branches to `main`, and require an independent reviewer if one is available. Configure these values in Environment secrets/variables; do not put them in repository files or logs.

| Name | Type | Purpose |
| --- | --- | --- |
| `SUPABASE_DB_URL` | Secret | Session-pooler URL copied from the staging project's Connect panel; user must be `postgres.tafjceemuetqjyngresg`, port `5432`, database `postgres`. |
| `SUPABASE_ANON_KEY` | Secret or variable | Publishable key for the staging Data/Storage API. |
| `SUPABASE_STORAGE_READ_JWT` | Secret | Short-lived JWT for an authenticated test account with read-only access to the required Storage objects. Do not use `service_role`. |
| `BACKUP_AGE_RECIPIENT` | Variable | Public age recipient used to encrypt the archive. |
| `BACKUP_AGE_IDENTITY` | Secret | Matching private age identity used only in the protected environment to verify decryption and restore. |
| `BACKUP_REPOSITORY_TOKEN` | Secret | Fine-grained token restricted to `gustav-j3an/mk9-date-homologation-backups`, with Contents read/write for release assets. |

The token cannot be created or stored by this workflow. Add it through GitHub's Environment settings and give it an expiry. It needs permission to create releases and upload assets in the private backup repository. The workflow refuses to upload if the destination repository is not private.

## Run procedure

1. Merge the workflow only after review; it must be present on `main` for `workflow_dispatch`.
2. Confirm the GitHub Environment secrets and required reviewer settings.
3. Confirm that the staging database password has not been rotated and that the Storage JWT is still valid.
4. Start **MK9 homologation backup validation** manually on `main` and check the confirmation box.
5. Review the run summary and private release. Record its SHA-256 and download the encrypted asset to a controlled recovery location.
6. Verify recovery by decrypting with the protected identity and checking the manifest and hashes. Never copy plaintext dump files into a public repository or workflow artifact.

## Restore scope and current Storage inventory

The homologation has `supabase_vault` installed. A vanilla PostgreSQL 17 service cannot restore that Supabase-managed extension, and a plain database dump does not include all cluster-level role state or Storage binary objects. The workflow records a full restore attempt and a clearly labeled partial restore that omits the Vault schema/extension and owner ACLs. It will not report a full restore. A full recovery test requires an authorized temporary Supabase clone; no clone is created by this workflow.

At the last read-only inventory, Storage had one private `visit-photos` object (68 bytes) and no objects in `absence-documents`. `public.visit_photos` had two metadata rows, one of which did not match a current Storage object by the recorded path or URL. The workflow exports existing objects without altering them and records that mismatch for review.

The Portal do Promotor preview exists in Vercel, but browser login, promoter credentials, and a disposable UI test dataset are not configured in this workflow. The portal flow must be tested separately with those credentials and data; the database backup job does not claim UI validation.

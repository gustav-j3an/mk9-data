# MK9 homologation backup workflow

This manual workflow is intended for the staging Supabase project `tafjceemuetqjyngresg` only. It uses a GitHub-hosted Ubuntu runner, PostgreSQL 17 client tools, Supabase CLI `3.0.0`, and a disposable local Supabase stack. It does not apply migrations, enable `pg_cron`, or write to the source database. Production's project reference and endpoint are intentionally absent from this implementation.

The job is available only on `codex/m38-backup-actions`. It requires the protected GitHub Environment `homologation-backup`, a successful exact-project preflight, the manual private-destination confirmation, a full restore and integrity comparison in the disposable stack, and encryption before it uploads anything to the external object store. The workflow has only `workflow_dispatch`, read-only repository permission, no GitHub artifact upload, and no Supabase or deployment token permissions.

## GitHub configuration

Create Environment `homologation-backup` in repository settings. Require at least one reviewer, restrict deployments to `codex/m38-backup-actions`, and protect that branch with reviewed changes. Keep the following values in the Environment (not repository-wide settings):

**Environment variables**

- `SUPABASE_PROJECT_REF` — fixed to the homologation project reference.
- `SUPABASE_PROJECT_URL` — homologation API URL.
- `BACKUP_S3_ENDPOINT_URL` — HTTPS endpoint for a private S3-compatible bucket, such as an already-existing Cloudflare R2 bucket.
- `BACKUP_S3_BUCKET` — private bucket name.
- `BACKUP_S3_REGION` — provider region (`auto` for R2).
- `BACKUP_S3_PREFIX` — dedicated path prefix, for example `mk9/homologation`.

**Environment secrets**

- `SUPABASE_DB_URL` — direct PostgreSQL connection string for staging only, username `postgres`, database `postgres`, TLS required.
- `SUPABASE_SERVICE_ROLE_KEY` — staging `service_role` JWT whose `ref` claim matches the staging project.
- `BACKUP_GPG_PASSPHRASE` — unique passphrase of at least 32 characters; store its recovery copy separately from the bucket.
- `BACKUP_S3_ACCESS_KEY_ID` and `BACKUP_S3_SECRET_ACCESS_KEY` — credentials scoped to write/read objects only in this one bucket, and to the prefix too if the provider supports prefix-scoped keys.

Configure the bucket private, enable versioning or equivalent retention if available, and restrict access to the backup operators. The workflow cannot independently prove provider-side public-access and retention settings; the run requires a manual confirmation. Do not place any production URL/key in these settings.

## Manual execution

After reviewing the workflow and configuring the Environment, the file must first be present on the repository's default branch for GitHub to accept its first `workflow_dispatch`. This implementation branch alone cannot show the initial **Run workflow** button or receive its first dispatch. This task does not merge it; a later separately approved integration is required. Once the workflow exists on the default branch, open **Actions → MK9 homologation backup and restore validation → Run workflow**, select `codex/m38-backup-actions`, enter `tafjceemuetqjyngresg`, and confirm the private external destination. The run stops before any source connection when an Environment value is absent or mismatched. It never runs automatically on push, pull request, schedule, or deployment.

## Backup contents and restore

The encrypted archive contains a PostgreSQL custom-format full dump, separate custom-role SQL and migration-history exports, a schema/data inventory, and a Storage export. Storage objects retain their bucket/path hierarchy; the manifest records bucket settings, object metadata, byte size, and SHA-256. The private objects remain private: export uses authenticated API requests and never creates public or signed URLs.

Before upload, the workflow inventories the database before export and after Storage collection; any data/schema change during that interval aborts the run. It checks the PostgreSQL archive and file hashes, starts a disposable local Supabase stack configured for PostgreSQL 17, restores the database into a fresh local database, compares schemas, per-table row counts and content digests, RLS flags, policies, function definitions/security/ACLs, triggers, views, and extension versions, and restores Storage bucket settings and objects into local buckets. It reapplies the bucket/object metadata recorded in the manifest, downloads each local object again, and checks its hash. Any mismatch stops the job before upload. Only the AES-256 encrypted archive is uploaded. The runner downloads the stored ciphertext once and byte-compares it with the local encrypted file. Runner files and containers are removed on success or failure; diagnostic command output is kept in the private temporary directory and deleted with it. The source inventory reads all table data twice, so schedule the manual run during a quiet period; otherwise it fails closed.

### Auth and Storage recovery limits

The database archive includes the PostgreSQL `auth` schema and its rows, and the inventory compares Auth data during the disposable database restore. Provider settings that live in the Supabase dashboard (OAuth credentials, SMTP, redirect URLs, CAPTCHA, MFA configuration) are not PostgreSQL data and are not included. Treat the archive as highly sensitive because it contains user records and authentication material.

Storage file bytes are not stored in PostgreSQL, so they are exported separately through authenticated Storage API calls. The encrypted manifest preserves bucket configuration, paths, object IDs, owner IDs, timestamps, and object metadata. The disposable Storage test recreates bucket settings, paths, bytes, timestamps, IDs and metadata, then verifies downloaded hashes. It does not import source Auth users into the separate local Storage API database, so it does not reassign source `owner_id` values there; those remain in the manifest and in the restored database archive. A live-project restore is deliberately not implemented: Supabase-managed Auth/Storage schemas and owner references require a separate reviewed recovery procedure for the target project.

For the isolated validation performed by this workflow, the order is roles, full database archive into a fresh local PostgreSQL 17 database, then Storage bucket/object reconstruction in the disposable local Storage API. For manual recovery, download the encrypted object with restricted credentials, decrypt using the separately stored passphrase, and verify `SHA256SUMS`. The database archive and Storage payload are separate recovery inputs. Do not apply the generic dump directly to a live Supabase project: managed Auth/Storage schema ownership and object-owner references need a target-specific reviewed procedure. Never point restore commands at production. This workflow validates an isolated restore; it does not restore the live homologation project.

## Limits

No backup has been run by this implementation. The real PostgreSQL and Storage restore path must complete successfully in GitHub Actions before treating an archive as recovery evidence. Supabase-managed schemas can differ between cloud and local platform images; any unsupported object, ownership, extension, or privilege causes restore validation to fail closed, before upload. Backups can contain personal data and private files, so the destination and passphrase require separate restricted custody. R2 and other S3 services may incur charges above their current free allowances.

# Recon API

This is the first local-first backend slice for Recon. It stores account and
workspace metadata, organization membership, reconciliation metadata, and
source manifests. It does not accept bank files, ledger files, `rawRow`, OCR
images, evidence binaries, or attachment data URLs.

## Local development

1. Copy `.env.example` to `.env` and keep `ENABLE_CLOUD_SOURCE_SYNC=false`.
2. Start PostgreSQL and the API with `docker compose -f compose.backend.yml up --build`.
3. For a host-run API, use `npm install`, then `npm run db:migrate`, `npm run db:seed`, and `npm run dev`.

The development seed creates `dev@recon.local` with password
`recon-dev-password`. Change this before using any shared environment.

Health checks are available at `/health/live` and `/health/ready`. The initial
authenticated API includes registration/login, organizations, reconciliation
creation/listing, and metadata-only source-manifest creation/listing with
duplicate SHA-256 detection. Access tokens expire after 15 minutes.

The server-side Phase 1 foundation includes refresh-token rotation, policy
history, append-only review events, sign-off and reopen workflows, and
metadata-only sync changes with idempotent client event IDs. Browser integration
still needs to be implemented in the browser client before production use.

The sync API rejects `rawRow`, file contents, data URLs, and source-file fields.
Start PostgreSQL before running `npm run db:migrate`; migrations are tracked in
the `schema_migrations` table and are safe to run repeatedly.
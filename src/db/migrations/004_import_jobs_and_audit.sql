ALTER TABLE source_manifests ADD COLUMN IF NOT EXISTS import_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS idx_source_manifests_import_id ON source_manifests(reconciliation_id, import_id) WHERE import_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id uuid NOT NULL REFERENCES reconciliations(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES users(id),
  import_id uuid NOT NULL,
  side text NOT NULL CHECK (side IN ('bank','ledger')),
  file_name text NOT NULL,
  sha256 text NOT NULL,
  mime_type text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reconciliation_id, import_id),
  UNIQUE (reconciliation_id, side, sha256)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reconciliation_id uuid REFERENCES reconciliations(id) ON DELETE SET NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_events_reconciliation ON audit_events(reconciliation_id, created_at);

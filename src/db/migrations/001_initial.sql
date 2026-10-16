CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE, display_name text NOT NULL,
  password_hash text, status text NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz
);
CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, country_code text NOT NULL DEFAULT 'UG',
  default_currency text NOT NULL DEFAULT 'UGX', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS organization_members (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','admin','preparer','reviewer','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (organization_id, user_id)
);
CREATE TABLE IF NOT EXISTS reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_name text NOT NULL, period_start date NOT NULL, period_end date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_progress','signed_off')),
  currency text NOT NULL, bank_name text, account_reference text, preparer_name text, reviewer_name text,
  bank_closing_balance numeric(20,2), ledger_closing_balance numeric(20,2), policy_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  locked_at timestamptz, local_revision integer NOT NULL DEFAULT 0, server_revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS source_manifests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reconciliation_id uuid NOT NULL REFERENCES reconciliations(id) ON DELETE CASCADE,
  side text NOT NULL CHECK (side IN ('bank','ledger')), file_name text NOT NULL, sha256 text NOT NULL,
  mime_type text NOT NULL, row_count integer NOT NULL CHECK (row_count >= 0), imported_at timestamptz NOT NULL,
  storage_mode text NOT NULL DEFAULT 'metadata_synced' CHECK (storage_mode IN ('local_only','metadata_synced','content_synced')),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (reconciliation_id, side, sha256)
);
CREATE TABLE IF NOT EXISTS review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reconciliation_id uuid REFERENCES reconciliations(id) ON DELETE SET NULL, actor_user_id uuid NOT NULL REFERENCES users(id),
  event_type text NOT NULL, entity_type text NOT NULL, entity_id uuid, payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  client_event_id uuid UNIQUE, occurred_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reconciliation_id uuid NOT NULL REFERENCES reconciliations(id) ON DELETE CASCADE,
  version integer NOT NULL, policy_json jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(reconciliation_id, version)
);
CREATE INDEX IF NOT EXISTS idx_reconciliations_org ON reconciliations(organization_id);
CREATE INDEX IF NOT EXISTS idx_events_reconciliation ON review_events(reconciliation_id, received_at);
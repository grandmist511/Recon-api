CREATE TABLE IF NOT EXISTS matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id uuid NOT NULL REFERENCES reconciliations(id) ON DELETE CASCADE,
  bank_line_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  ledger_line_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  rule text,
  confidence numeric(5,4),
  status text NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'accepted', 'rejected')),
  reason_chips jsonb NOT NULL DEFAULT '[]'::jsonb,
  multiple_candidates boolean NOT NULL DEFAULT false,
  double_check boolean NOT NULL DEFAULT false,
  note text,
  reason_code text,
  difference_amount numeric(20,2),
  engine_version text,
  policy_version integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id uuid NOT NULL REFERENCES reconciliations(id) ON DELETE CASCADE,
  line_id uuid,
  side text CHECK (side IN ('bank', 'ledger')),
  reason_code text NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'waived')),
  local_revision integer NOT NULL DEFAULT 0,
  server_revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evidence_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exception_id uuid NOT NULL REFERENCES exceptions(id) ON DELETE CASCADE,
  name text NOT NULL,
  mime_type text NOT NULL,
  size integer NOT NULL CHECK (size >= 0),
  reference_text text,
  sha256 text,
  storage_mode text NOT NULL DEFAULT 'metadata_only' CHECK (storage_mode IN ('local_only', 'metadata_only', 'content_synced')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS signoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id uuid NOT NULL REFERENCES reconciliations(id) ON DELETE CASCADE,
  preparer_user_id uuid NOT NULL REFERENCES users(id),
  reviewer_user_id uuid NOT NULL REFERENCES users(id),
  review_note text,
  readiness_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  signed_at timestamptz,
  reopened_at timestamptz,
  reopen_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (preparer_user_id <> reviewer_user_id)
);

CREATE TABLE IF NOT EXISTS bot_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reconciliation_id uuid REFERENCES reconciliations(id) ON DELETE SET NULL,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bot_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES bot_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  text text NOT NULL,
  flagged boolean NOT NULL DEFAULT false,
  model_source text,
  policy_version integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  density text NOT NULL DEFAULT 'comfortable' CHECK (density IN ('comfortable', 'compact')),
  reduced_motion boolean NOT NULL DEFAULT false,
  save_bot_chats boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_matches_reconciliation ON matches(reconciliation_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_exceptions_reconciliation ON exceptions(reconciliation_id, status);
CREATE INDEX IF NOT EXISTS idx_evidence_exception ON evidence_references(exception_id);
CREATE INDEX IF NOT EXISTS idx_signoffs_reconciliation ON signoffs(reconciliation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bot_conversations_user ON bot_conversations(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_bot_messages_conversation ON bot_messages(conversation_id, created_at);
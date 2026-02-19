-- =============================================================================
-- Migration: 20260219000001_cav_v2_intent_delta_breach.sql
--
-- CAV Level 3 (Intent Registry) + Level 4 (Formal Alignment Deltas + Envelopes)
--
-- New tables:
--   intent_artifacts       — artifact head record per topic+dimension
--   intent_versions        — versioned intent definitions (JSONB)
--   alignment_deltas       — time-series delta computations
--   envelope_breaches      — breach events (withinEnvelope flips)
--   convergence_actions    — user-logged corrective actions (measure-only)
--
-- All tables:
--   - tenant-scoped with explicit tenant_id foreign key
--   - RLS enabled — policies restrict to authenticated tenant users
--   - Service-role bypasses RLS (used by align-api stores)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. intent_artifacts
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS intent_artifacts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  topic_scope     text        NOT NULL,       -- MQTT wildcard pattern (+/#)
  dimension       text        NOT NULL        CHECK (dimension IN ('shape', 'cadence', 'domain')),
  precedence      integer     NOT NULL DEFAULT 0,
  current_version integer     NOT NULL DEFAULT 0,
  active_version_id uuid      REFERENCES intent_versions(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  status          text        NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
  created_by      uuid        NOT NULL REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intent_artifacts_tenant
  ON intent_artifacts(tenant_id);

CREATE INDEX IF NOT EXISTS idx_intent_artifacts_tenant_dimension
  ON intent_artifacts(tenant_id, dimension);

CREATE INDEX IF NOT EXISTS idx_intent_artifacts_tenant_status
  ON intent_artifacts(tenant_id, status);

-- RLS
ALTER TABLE intent_artifacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON intent_artifacts
  FOR ALL
  USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- 2. intent_versions
--
-- Partial unique index enforces only one 'active' version per artifact.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS intent_versions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id     uuid        NOT NULL REFERENCES intent_artifacts(id) ON DELETE CASCADE,
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version_number  integer     NOT NULL,
  definition      jsonb       NOT NULL,       -- SchemaVersion-tagged JSONB payload
  status          text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'superseded')),
  effective_from  timestamptz NOT NULL,
  effective_until timestamptz,               -- NULL = still active
  created_by      uuid        NOT NULL REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT intent_versions_artifact_version_unique UNIQUE (artifact_id, version_number)
);

-- Enforces only one active version per artifact at the DB level
CREATE UNIQUE INDEX IF NOT EXISTS idx_intent_versions_one_active_per_artifact
  ON intent_versions(artifact_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_intent_versions_tenant
  ON intent_versions(tenant_id);

CREATE INDEX IF NOT EXISTS idx_intent_versions_artifact
  ON intent_versions(artifact_id);

CREATE INDEX IF NOT EXISTS idx_intent_versions_active_effective
  ON intent_versions(tenant_id, status, effective_from)
  WHERE status = 'active';

-- RLS
ALTER TABLE intent_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON intent_versions
  FOR ALL
  USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()
    )
  );

-- Now add the FK from intent_artifacts back to intent_versions
-- (deferred because of the circular reference)
ALTER TABLE intent_artifacts
  ADD CONSTRAINT fk_intent_artifacts_active_version
  FOREIGN KEY (active_version_id)
  REFERENCES intent_versions(id)
  ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;

-- -----------------------------------------------------------------------------
-- 3. alignment_deltas
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS alignment_deltas (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  intent_version_id uuid        NOT NULL REFERENCES intent_versions(id),
  observed_truth_id uuid        NOT NULL REFERENCES observed_truths(id),
  topic_scope       text        NOT NULL,
  dimension         text        NOT NULL CHECK (dimension IN ('shape', 'cadence', 'domain')),
  delta_value       numeric(10,6) NOT NULL CHECK (delta_value >= 0 AND delta_value <= 1),
  delta_detail      jsonb       NOT NULL,     -- Explainability payload (schemaVersion-tagged)
  within_envelope   boolean     NOT NULL,
  computed_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alignment_deltas_tenant
  ON alignment_deltas(tenant_id);

CREATE INDEX IF NOT EXISTS idx_alignment_deltas_tenant_topic_dimension
  ON alignment_deltas(tenant_id, topic_scope, dimension);

CREATE INDEX IF NOT EXISTS idx_alignment_deltas_computed_at
  ON alignment_deltas(tenant_id, computed_at DESC);

CREATE INDEX IF NOT EXISTS idx_alignment_deltas_intent_version
  ON alignment_deltas(intent_version_id);

-- RLS
ALTER TABLE alignment_deltas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON alignment_deltas
  FOR ALL
  USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- 4. envelope_breaches
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS envelope_breaches (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  intent_version_id uuid        NOT NULL REFERENCES intent_versions(id),
  first_delta_id    uuid        NOT NULL REFERENCES alignment_deltas(id),
  topic_scope       text        NOT NULL,
  dimension         text        NOT NULL CHECK (dimension IN ('shape', 'cadence', 'domain')),
  status            text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved')),
  evidence          jsonb       NOT NULL,     -- Immutable snapshot at breach onset
  breached_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz
);

CREATE INDEX IF NOT EXISTS idx_envelope_breaches_tenant
  ON envelope_breaches(tenant_id);

CREATE INDEX IF NOT EXISTS idx_envelope_breaches_tenant_status
  ON envelope_breaches(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_envelope_breaches_tenant_topic_dimension
  ON envelope_breaches(tenant_id, topic_scope, dimension);

-- Only one active breach per (tenant, topic, dimension, intent_version)
CREATE UNIQUE INDEX IF NOT EXISTS idx_envelope_breaches_one_active
  ON envelope_breaches(tenant_id, topic_scope, dimension, intent_version_id)
  WHERE status = 'active';

-- RLS
ALTER TABLE envelope_breaches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON envelope_breaches
  FOR ALL
  USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- 5. convergence_actions
--
-- User-logged only. taken_by is NOT NULL — enforces the architectural invariant
-- that no automated process can create a convergence action.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS convergence_actions (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  breach_id             uuid        NOT NULL REFERENCES envelope_breaches(id),
  description           text        NOT NULL,
  action_taken_at       timestamptz NOT NULL,
  taken_by              uuid        NOT NULL REFERENCES auth.users(id),  -- Required. Never system-generated.
  post_action_delta_id  uuid        REFERENCES alignment_deltas(id),     -- Linked retrospectively
  effectiveness         text        NOT NULL DEFAULT 'unknown'
                          CHECK (effectiveness IN ('converging', 'stable', 'diverging', 'unknown')),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_convergence_actions_tenant
  ON convergence_actions(tenant_id);

CREATE INDEX IF NOT EXISTS idx_convergence_actions_breach
  ON convergence_actions(breach_id);

-- RLS
ALTER TABLE convergence_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON convergence_actions
  FOR ALL
  USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()
    )
  );

-- =============================================================================
-- Comments for schema documentation
-- =============================================================================

COMMENT ON TABLE  intent_artifacts   IS 'CAV Level 3 — Intent artifact head records. One per topic_scope+dimension.';
COMMENT ON TABLE  intent_versions    IS 'CAV Level 3 — Versioned intent definitions. Only one active version per artifact.';
COMMENT ON TABLE  alignment_deltas   IS 'CAV Level 4 — Time-series delta computations. Delta_k(t) = D_k(i_k(t), s_k(t)).';
COMMENT ON TABLE  envelope_breaches  IS 'CAV Level 4 — Envelope breach events. Created when within_envelope flips false.';
COMMENT ON TABLE  convergence_actions IS 'CAV Level 6 scaffold (measure-only). User-logged corrective actions. taken_by NOT NULL enforces no automation.';

COMMENT ON COLUMN intent_artifacts.topic_scope   IS 'MQTT wildcard pattern using + (single-level) and # (multi-level). Matched at ingest-time.';
COMMENT ON COLUMN intent_artifacts.precedence    IS 'Higher value wins when multiple artifacts match the same topic+dimension.';
COMMENT ON COLUMN intent_versions.definition     IS 'JSONB intent definition. Must include schemaVersion field. Validated on insert.';
COMMENT ON COLUMN alignment_deltas.delta_value   IS 'Scalar alignment distance in [0.0, 1.0]. 0.0 = perfect alignment.';
COMMENT ON COLUMN alignment_deltas.delta_detail  IS 'Explainability payload. Includes schemaVersion, reason, violations[], penaltyBreakdown.';
COMMENT ON COLUMN envelope_breaches.evidence     IS 'Immutable snapshot of delta_detail at breach onset. Audit trail.';
COMMENT ON COLUMN convergence_actions.taken_by   IS 'User UUID. NOT NULL. Enforces that only humans log convergence actions.';
COMMENT ON COLUMN convergence_actions.post_action_delta_id IS 'Linked retrospectively by the system after a new delta is computed post-action.';

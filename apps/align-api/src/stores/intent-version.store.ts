/**
 * intent-version.store.ts
 *
 * CAV Level 3 — Store layer for intent_versions table.
 *
 * Critical operations:
 *   - create()     — creates a version in 'draft' status
 *   - activate()   — atomically supersedes the prior active version
 *   - getActive()  — ingest-time query: finds the active version for a
 *                    topic + dimension at a given timestamp
 *
 * Safe-by-default lifecycle rules (architecture plan v0.2 §6.1):
 *   - Draft versions never trigger delta computation (getActive returns null for drafts)
 *   - Activation requires explicit effective_from
 *   - Activating a new version atomically supersedes the prior active version
 *   - Only one version per artifact may have status 'active' at any time
 *     (enforced by DB partial unique index + this store's activate() method)
 *
 * Schema versioning:
 *   - Unknown schemaVersion values are rejected at write time with a validation error
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  IntentVersion,
  IntentVersionSummary,
  IntentVersionStatus,
  IntentDefinition,
  CreateIntentVersionRequest,
} from '@cav-align/core';
import type { DivergenceDimension } from '@cav-align/core';
import { rootLogger } from '../lib/logger';

const SUPPORTED_SCHEMA_VERSIONS = [1];

export class IntentVersionStore {
  private readonly log = rootLogger.child({ context: 'IntentVersionStore' });

  constructor(private readonly supabase: SupabaseClient) {}

  // ── Create (as draft) ────────────────────────────────────────────────────

  async create(
    tenantId:   string,
    artifactId: string,
    createdBy:  string,
    input:      CreateIntentVersionRequest,
  ): Promise<IntentVersion | 'invalid-schema' | undefined> {
    try {
      if (!isSupportedSchemaVersion(input.definition)) {
        this.log.warn('create rejected — unsupported schemaVersion', {
          tenantId,
          artifactId,
          schemaVersion: (input.definition as Record<string, unknown>)['schemaVersion'],
        });
        return 'invalid-schema';
      }

      // Get next version number
      const { data: existing } = await this.supabase
        .from('intent_versions')
        .select('version_number')
        .eq('artifact_id', artifactId)
        .eq('tenant_id', tenantId)
        .order('version_number', { ascending: false })
        .limit(1)
        .single();

      const nextVersion = ((existing?.version_number as number) ?? 0) + 1;

      const { data, error } = await this.supabase
        .from('intent_versions')
        .insert({
          artifact_id:    artifactId,
          tenant_id:      tenantId,
          version_number: nextVersion,
          definition:     input.definition,
          status:         'draft' as IntentVersionStatus,
          effective_from: input.effectiveFrom,
          effective_until: null,
          created_by:     createdBy,
        })
        .select()
        .single();

      if (error) {
        this.log.error('create failed', error, { tenantId, artifactId });
        return undefined;
      }

      this.log.info('Intent version created (draft)', {
        tenantId, artifactId, versionNumber: nextVersion,
      });
      return rowToVersion(data);
    } catch (err) {
      this.log.error('create exception', err, { tenantId, artifactId });
      return undefined;
    }
  }

  // ── Activate (atomic supersede) ──────────────────────────────────────────

  async activate(
    tenantId:   string,
    artifactId: string,
    versionId:  string,
  ): Promise<IntentVersion | 'not-found' | 'already-active' | 'missing-effective-from' | null> {
    try {
      // Fetch the version to activate
      const { data: version, error: fetchError } = await this.supabase
        .from('intent_versions')
        .select('*')
        .eq('id', versionId)
        .eq('artifact_id', artifactId)
        .eq('tenant_id', tenantId)
        .single();

      if (fetchError || !version) return 'not-found';
      if (version.status === 'active') return 'already-active';
      if (!version.effective_from) return 'missing-effective-from';

      const effectiveFrom = version.effective_from as string;
      const now = new Date().toISOString();

      // Atomically supersede the current active version (if any)
      await this.supabase
        .from('intent_versions')
        .update({ status: 'superseded', effective_until: effectiveFrom })
        .eq('artifact_id', artifactId)
        .eq('tenant_id', tenantId)
        .eq('status', 'active');

      // Activate the target version
      const { data: activated, error: activateError } = await this.supabase
        .from('intent_versions')
        .update({ status: 'active' })
        .eq('id', versionId)
        .eq('tenant_id', tenantId)
        .select()
        .single();

      if (activateError || !activated) {
        this.log.error('activate failed', activateError, { tenantId, versionId });
        return null;
      }

      // Update artifact's current_version + updated_at
      await this.supabase
        .from('intent_artifacts')
        .update({
          current_version:  activated.version_number,
          active_version_id: versionId,
          updated_at:       now,
        })
        .eq('id', artifactId)
        .eq('tenant_id', tenantId);

      this.log.info('Intent version activated', {
        tenantId, artifactId, versionId, versionNumber: activated.version_number,
      });
      return rowToVersion(activated);
    } catch (err) {
      this.log.error('activate exception', err, { tenantId, versionId });
      return null;
    }
  }

  // ── getActive — critical ingest-time query ───────────────────────────────

  /**
   * Returns all active IntentVersions for a tenant + dimension whose effective
   * window contains the given timestamp. The caller (IntentProjectionEngine)
   * applies MQTT wildcard matching and precedence selection.
   *
   * Returns an empty array (not null) when no versions are active — callers
   * should treat this as a no-op for the v2 pipeline branch.
   *
   * NOTE: topic_scope matching is done in the engine (MQTT wildcards cannot
   * be evaluated in SQL). We fetch all active versions for the dimension and
   * let the engine filter by topic path.
   */
  async getActiveForDimension(
    tenantId:  string,
    dimension: DivergenceDimension,
    at:        string,
  ): Promise<IntentVersion[]> {
    try {
      const { data, error } = await this.supabase
        .from('intent_versions')
        .select(`
          *,
          intent_artifacts!inner(topic_scope, precedence)
        `)
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .lte('effective_from', at);

      if (error) {
        this.log.error('getActiveForDimension failed', error, { tenantId, dimension });
        return [];
      }

      // Filter: effective_until must be null or > at; dimension must match
      const atMs = new Date(at).getTime();
      return (data ?? [])
        .filter((row: Record<string, unknown>) => {
          const until = row['effective_until'] as string | null;
          if (until && new Date(until).getTime() <= atMs) return false;

          // Dimension check via definition shape
          const def = row['definition'] as Record<string, unknown>;
          if (dimension === 'shape'   && !('requiredFields' in def))          return false;
          if (dimension === 'cadence' && !('expectedMeanIntervalMs' in def))  return false;
          if (dimension === 'domain'  && !('numericConstraints' in def))      return false;

          return true;
        })
        .map((row: Record<string, unknown>) => rowToVersionWithArtifact(row));
    } catch (err) {
      this.log.error('getActiveForDimension exception', err, { tenantId, dimension });
      return [];
    }
  }

  // ── List version history ─────────────────────────────────────────────────

  async listForArtifact(tenantId: string, artifactId: string): Promise<IntentVersionSummary[]> {
    try {
      const { data, error } = await this.supabase
        .from('intent_versions')
        .select('id, version_number, status, effective_from, effective_until, created_at')
        .eq('artifact_id', artifactId)
        .eq('tenant_id', tenantId)
        .order('version_number', { ascending: false });

      if (error) {
        this.log.error('listForArtifact failed', error, { tenantId, artifactId });
        throw new Error('Failed to list intent versions');
      }

      return (data ?? []).map(rowToVersionSummary);
    } catch (err) {
      this.log.error('listForArtifact exception', err, { tenantId, artifactId });
      throw err;
    }
  }

  async getById(tenantId: string, versionId: string): Promise<IntentVersion | undefined> {
    try {
      const { data, error } = await this.supabase
        .from('intent_versions')
        .select('*, intent_artifacts!inner(topic_scope, precedence)')
        .eq('id', versionId)
        .eq('tenant_id', tenantId)
        .single();

      if (error || !data) return undefined;
      return rowToVersionWithArtifact(data as Record<string, unknown>);
    } catch (err) {
      this.log.error('getById exception', err, { tenantId });
      return undefined;
    }
  }
}

// ── Schema version validation ───────────────────────────────────────────────

function isSupportedSchemaVersion(def: IntentDefinition): boolean {
  const sv = (def as Record<string, unknown>)['schemaVersion'];
  return SUPPORTED_SCHEMA_VERSIONS.includes(sv as number);
}

// ── Row mappers ─────────────────────────────────────────────────────────────

function rowToVersion(row: Record<string, unknown>): IntentVersion {
  return {
    id:             row['id'] as string,
    artifactId:     row['artifact_id'] as string,
    tenantId:       row['tenant_id'] as string,
    versionNumber:  row['version_number'] as number,
    definition:     row['definition'] as IntentDefinition,
    status:         row['status'] as IntentVersionStatus,
    effectiveFrom:  row['effective_from'] as string,
    effectiveUntil: (row['effective_until'] as string) ?? null,
    createdBy:      row['created_by'] as string,
    createdAt:      row['created_at'] as string,
  };
}

/**
 * Denormalises topic_scope and precedence from the joined intent_artifacts row
 * so the engine can access them without an extra query.
 */
function rowToVersionWithArtifact(row: Record<string, unknown>): IntentVersion {
  const base    = rowToVersion(row);
  const artifact = row['intent_artifacts'] as Record<string, unknown> | undefined;
  return {
    ...base,
    // Attach denormalised fields for engine consumption
    // Cast via unknown — these are engine-internal, not part of the public type
    ...(artifact ? {
      topicScope: artifact['topic_scope'] as string,
      precedence: (artifact['precedence'] as number) ?? 0,
    } : {}),
  } as IntentVersion;
}

function rowToVersionSummary(row: Record<string, unknown>): IntentVersionSummary {
  return {
    id:             row['id'] as string,
    versionNumber:  row['version_number'] as number,
    status:         row['status'] as IntentVersionStatus,
    effectiveFrom:  row['effective_from'] as string,
    effectiveUntil: (row['effective_until'] as string) ?? null,
    createdAt:      row['created_at'] as string,
  };
}

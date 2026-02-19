/**
 * intent-artifact.store.ts
 *
 * CAV Level 3 — Store layer for intent_artifacts table.
 *
 * Rules (v1 hardening contract extended):
 *   - Service-role client throughout.
 *   - tenantId required explicitly on every method.
 *   - Explicit .eq('tenant_id', tenantId) on every query — no RLS reliance.
 *   - No business logic, no token parsing.
 *   - Validates MQTT wildcard syntax on create (+ and # only).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  IntentArtifact,
  IntentArtifactSummary,
  IntentArtifactStatus,
  CreateIntentArtifactRequest,
} from '@cav-align/core';
import type { DivergenceDimension } from '@cav-align/core';
import { rootLogger } from '../lib/logger';

export interface ListArtifactFilters {
  dimension?: DivergenceDimension;
  status?:    IntentArtifactStatus;
  topicScope?: string;
}

export class IntentArtifactStore {
  private readonly log = rootLogger.child({ context: 'IntentArtifactStore' });

  constructor(private readonly supabase: SupabaseClient) {}

  async create(
    tenantId: string,
    createdBy: string,
    input: CreateIntentArtifactRequest,
  ): Promise<IntentArtifact | undefined> {
    try {
      if (!isValidMqttScope(input.topicScope)) {
        this.log.warn('create rejected — invalid MQTT topic_scope', { tenantId, topicScope: input.topicScope });
        return undefined;
      }

      const { data, error } = await this.supabase
        .from('intent_artifacts')
        .insert({
          tenant_id:   tenantId,
          name:        input.name,
          topic_scope: input.topicScope,
          dimension:   input.dimension,
          precedence:  input.precedence ?? 0,
          status:      'active' as IntentArtifactStatus,
          created_by:  createdBy,
        })
        .select()
        .single();

      if (error) {
        this.log.error('create failed', error, { tenantId });
        return undefined;
      }

      this.log.info('Intent artifact created', { tenantId, id: data?.id });
      return rowToArtifact(data);
    } catch (err) {
      this.log.error('create exception', err, { tenantId });
      return undefined;
    }
  }

  async list(tenantId: string, filters: ListArtifactFilters = {}): Promise<IntentArtifactSummary[]> {
    try {
      let query = this.supabase
        .from('intent_artifacts')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('updated_at', { ascending: false });

      if (filters.dimension)  query = query.eq('dimension', filters.dimension);
      if (filters.status)     query = query.eq('status', filters.status);
      if (filters.topicScope) query = query.eq('topic_scope', filters.topicScope);

      const { data, error } = await query;
      if (error) {
        this.log.error('list failed', error, { tenantId });
        throw new Error('Failed to list intent artifacts');
      }

      return (data ?? []).map(rowToArtifactSummary);
    } catch (err) {
      this.log.error('list exception', err, { tenantId });
      throw err;
    }
  }

  async getById(tenantId: string, id: string): Promise<IntentArtifact | undefined> {
    try {
      const { data, error } = await this.supabase
        .from('intent_artifacts')
        .select('*')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .single();

      if (error || !data) return undefined;
      return rowToArtifact(data);
    } catch (err) {
      this.log.error('getById exception', err, { tenantId });
      return undefined;
    }
  }

  async archive(tenantId: string, id: string): Promise<IntentArtifact | 'not-found' | null> {
    try {
      const { data: existing, error: fetchError } = await this.supabase
        .from('intent_artifacts')
        .select('id, status')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .single();

      if (fetchError || !existing) return 'not-found';

      const { data, error } = await this.supabase
        .from('intent_artifacts')
        .update({ status: 'archived', updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .select()
        .single();

      if (error || !data) {
        this.log.error('archive failed', error, { tenantId, id });
        return null;
      }

      this.log.info('Intent artifact archived', { tenantId, id });
      return rowToArtifact(data);
    } catch (err) {
      this.log.error('archive exception', err, { tenantId });
      return null;
    }
  }
}

// ── MQTT scope validation ───────────────────────────────────────────────────

function isValidMqttScope(scope: string): boolean {
  if (!scope || scope.length === 0) return false;
  const levels = scope.split('/');
  for (let i = 0; i < levels.length; i++) {
    const level = levels[i];
    if (level === '#') {
      // # must be the last level
      return i === levels.length - 1;
    }
    if (level.includes('#')) return false;
    if (level.includes('+') && level !== '+') return false;
  }
  return true;
}

// ── Row mappers ─────────────────────────────────────────────────────────────

function rowToArtifact(row: Record<string, unknown>): IntentArtifact {
  return {
    id:             row['id'] as string,
    tenantId:       row['tenant_id'] as string,
    name:           row['name'] as string,
    topicScope:     row['topic_scope'] as string,
    dimension:      row['dimension'] as DivergenceDimension,
    precedence:     (row['precedence'] as number) ?? 0,
    currentVersion: (row['current_version'] as number) ?? 0,
    status:         row['status'] as IntentArtifactStatus,
    createdBy:      row['created_by'] as string,
    createdAt:      row['created_at'] as string,
    updatedAt:      row['updated_at'] as string,
  };
}

function rowToArtifactSummary(row: Record<string, unknown>): IntentArtifactSummary {
  return {
    id:              row['id'] as string,
    name:            row['name'] as string,
    topicScope:      row['topic_scope'] as string,
    dimension:       row['dimension'] as DivergenceDimension,
    precedence:      (row['precedence'] as number) ?? 0,
    status:          row['status'] as IntentArtifactStatus,
    currentVersion:  (row['current_version'] as number) ?? 0,
    activeVersionId: (row['active_version_id'] as string) ?? null,
    updatedAt:       row['updated_at'] as string,
  };
}

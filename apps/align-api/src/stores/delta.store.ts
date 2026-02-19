/**
 * delta.store.ts
 *
 * CAV Level 4 — Store layer for alignment_deltas table.
 *
 * Rules (v1 hardening contract extended):
 *   - Service-role client throughout.
 *   - tenantId required explicitly on every method.
 *   - Explicit .eq('tenant_id', tenantId) on every query.
 *   - No business logic.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AlignmentDelta,
  AlignmentDeltaSummary,
  DeltaDetail,
} from '@cav-align/core';
import type { DivergenceDimension } from '@cav-align/core';
import { rootLogger } from '../lib/logger';

export interface PersistDeltaInput {
  tenantId:        string;
  intentVersionId: string;
  observedTruthId: string;
  topicScope:      string;
  dimension:       DivergenceDimension;
  deltaValue:      number;
  deltaDetail:     DeltaDetail;
  withinEnvelope:  boolean;
  computedAt:      string;
}

export interface DeltaQueryFilters {
  topicScope?: string;
  dimension?:  DivergenceDimension;
  from?:       string;  // ISO 8601
  until?:      string;  // ISO 8601
}

export class DeltaStore {
  private readonly log = rootLogger.child({ context: 'DeltaStore' });

  constructor(private readonly supabase: SupabaseClient) {}

  async persist(input: PersistDeltaInput): Promise<string | undefined> {
    try {
      const { data, error } = await this.supabase
        .from('alignment_deltas')
        .insert({
          tenant_id:         input.tenantId,
          intent_version_id: input.intentVersionId,
          observed_truth_id: input.observedTruthId,
          topic_scope:       input.topicScope,
          dimension:         input.dimension,
          delta_value:       input.deltaValue,
          delta_detail:      input.deltaDetail,
          within_envelope:   input.withinEnvelope,
          computed_at:       input.computedAt,
        })
        .select('id')
        .single();

      if (error) {
        this.log.error('persist failed', error, { tenantId: input.tenantId });
        return undefined;
      }

      return data?.id as string;
    } catch (err) {
      this.log.error('persist exception', err);
      return undefined;
    }
  }

  async query(tenantId: string, filters: DeltaQueryFilters = {}): Promise<AlignmentDeltaSummary[]> {
    try {
      let query = this.supabase
        .from('alignment_deltas')
        .select('id, dimension, delta_value, within_envelope, computed_at')
        .eq('tenant_id', tenantId)
        .order('computed_at', { ascending: false })
        .limit(500);

      if (filters.topicScope) query = query.eq('topic_scope', filters.topicScope);
      if (filters.dimension)  query = query.eq('dimension', filters.dimension);
      if (filters.from)       query = query.gte('computed_at', filters.from);
      if (filters.until)      query = query.lte('computed_at', filters.until);

      const { data, error } = await query;
      if (error) {
        this.log.error('query failed', error, { tenantId });
        throw new Error('Failed to query alignment deltas');
      }

      return (data ?? []).map(rowToDeltaSummary);
    } catch (err) {
      this.log.error('query exception', err, { tenantId });
      throw err;
    }
  }

  async getById(tenantId: string, id: string): Promise<AlignmentDelta | undefined> {
    try {
      const { data, error } = await this.supabase
        .from('alignment_deltas')
        .select('*')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .single();

      if (error || !data) return undefined;
      return rowToDelta(data as Record<string, unknown>);
    } catch (err) {
      this.log.error('getById exception', err, { tenantId });
      return undefined;
    }
  }

  /**
   * Returns the most recent delta for a (tenant, topicScope, dimension, intentVersionId).
   * Used by the orchestrator to determine if a breach should be opened or resolved.
   */
  async getLatest(
    tenantId:        string,
    topicScope:      string,
    dimension:       DivergenceDimension,
    intentVersionId: string,
  ): Promise<AlignmentDelta | undefined> {
    try {
      const { data, error } = await this.supabase
        .from('alignment_deltas')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('topic_scope', topicScope)
        .eq('dimension', dimension)
        .eq('intent_version_id', intentVersionId)
        .order('computed_at', { ascending: false })
        .limit(1)
        .single();

      if (error || !data) return undefined;
      return rowToDelta(data as Record<string, unknown>);
    } catch {
      return undefined;
    }
  }
}

function rowToDelta(row: Record<string, unknown>): AlignmentDelta {
  return {
    id:              row['id'] as string,
    tenantId:        row['tenant_id'] as string,
    intentVersionId: row['intent_version_id'] as string,
    observedTruthId: row['observed_truth_id'] as string,
    topicScope:      row['topic_scope'] as string,
    dimension:       row['dimension'] as DivergenceDimension,
    deltaValue:      row['delta_value'] as number,
    deltaDetail:     row['delta_detail'] as DeltaDetail,
    withinEnvelope:  row['within_envelope'] as boolean,
    computedAt:      row['computed_at'] as string,
  };
}

function rowToDeltaSummary(row: Record<string, unknown>): AlignmentDeltaSummary {
  return {
    id:             row['id'] as string,
    dimension:      row['dimension'] as DivergenceDimension,
    deltaValue:     row['delta_value'] as number,
    withinEnvelope: row['within_envelope'] as boolean,
    computedAt:     row['computed_at'] as string,
  };
}

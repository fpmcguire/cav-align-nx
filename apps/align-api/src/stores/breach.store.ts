/**
 * breach.store.ts
 *
 * CAV Level 4 — Store layer for envelope_breaches table.
 *
 * Breach lifecycle: open (active) → resolve (resolved).
 * Created when within_envelope flips false. Resolved when it returns true.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  EnvelopeBreach,
  EnvelopeBreachSummary,
  BreachStatus,
  BreachEvidence,
} from '@cav-align/core';
import type { DivergenceDimension } from '@cav-align/core';
import { rootLogger } from '../lib/logger';

export interface OpenBreachInput {
  tenantId:        string;
  intentVersionId: string;
  firstDeltaId:    string;
  topicScope:      string;
  dimension:       DivergenceDimension;
  evidence:        BreachEvidence;
  breachedAt:      string;
}

export interface ListBreachFilters {
  status?:    BreachStatus;
  dimension?: DivergenceDimension;
  topicScope?: string;
}

export class BreachStore {
  private readonly log = rootLogger.child({ context: 'BreachStore' });

  constructor(private readonly supabase: SupabaseClient) {}

  async open(input: OpenBreachInput): Promise<string | undefined> {
    try {
      const { data, error } = await this.supabase
        .from('envelope_breaches')
        .insert({
          tenant_id:         input.tenantId,
          intent_version_id: input.intentVersionId,
          first_delta_id:    input.firstDeltaId,
          topic_scope:       input.topicScope,
          dimension:         input.dimension,
          status:            'active',
          evidence:          input.evidence,
          breached_at:       input.breachedAt,
          resolved_at:       null,
        })
        .select('id')
        .single();

      if (error) {
        this.log.error('open failed', error, { tenantId: input.tenantId });
        return undefined;
      }

      this.log.info('Envelope breach opened', {
        tenantId:  input.tenantId,
        topicScope: input.topicScope,
        dimension:  input.dimension,
        breachId:   data?.id,
      });

      return data?.id as string;
    } catch (err) {
      this.log.error('open exception', err);
      return undefined;
    }
  }

  async resolve(tenantId: string, breachId: string, resolvedAt: string): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .from('envelope_breaches')
        .update({ status: 'resolved', resolved_at: resolvedAt })
        .eq('id', breachId)
        .eq('tenant_id', tenantId)
        .eq('status', 'active');

      if (error) {
        this.log.error('resolve failed', error, { tenantId, breachId });
        return false;
      }

      this.log.info('Envelope breach resolved', { tenantId, breachId });
      return true;
    } catch (err) {
      this.log.error('resolve exception', err, { tenantId, breachId });
      return false;
    }
  }

  /**
   * Returns the currently active breach for a (tenant, topicScope, dimension, intentVersionId).
   * Used by the orchestrator to decide whether to open a new breach or resolve an existing one.
   */
  async getActiveBreach(
    tenantId:        string,
    topicScope:      string,
    dimension:       DivergenceDimension,
    intentVersionId: string,
  ): Promise<EnvelopeBreach | undefined> {
    try {
      const { data, error } = await this.supabase
        .from('envelope_breaches')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('topic_scope', topicScope)
        .eq('dimension', dimension)
        .eq('intent_version_id', intentVersionId)
        .eq('status', 'active')
        .order('breached_at', { ascending: false })
        .limit(1)
        .single();

      if (error || !data) return undefined;
      return rowToBreach(data as Record<string, unknown>);
    } catch {
      return undefined;
    }
  }

  async list(tenantId: string, filters: ListBreachFilters = {}): Promise<EnvelopeBreachSummary[]> {
    try {
      let query = this.supabase
        .from('envelope_breaches')
        .select('id, topic_scope, dimension, status, evidence, breached_at, resolved_at')
        .eq('tenant_id', tenantId)
        .order('breached_at', { ascending: false });

      if (filters.status)     query = query.eq('status', filters.status);
      if (filters.dimension)  query = query.eq('dimension', filters.dimension);
      if (filters.topicScope) query = query.eq('topic_scope', filters.topicScope);

      const { data, error } = await query;
      if (error) {
        this.log.error('list failed', error, { tenantId });
        throw new Error('Failed to list envelope breaches');
      }

      return (data ?? []).map(rowToBreachSummary);
    } catch (err) {
      this.log.error('list exception', err, { tenantId });
      throw err;
    }
  }

  async getById(tenantId: string, id: string): Promise<EnvelopeBreach | undefined> {
    try {
      const { data, error } = await this.supabase
        .from('envelope_breaches')
        .select('*')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .single();

      if (error || !data) return undefined;
      return rowToBreach(data as Record<string, unknown>);
    } catch (err) {
      this.log.error('getById exception', err, { tenantId });
      return undefined;
    }
  }
}

function rowToBreach(row: Record<string, unknown>): EnvelopeBreach {
  return {
    id:              row['id'] as string,
    tenantId:        row['tenant_id'] as string,
    intentVersionId: row['intent_version_id'] as string,
    firstDeltaId:    row['first_delta_id'] as string,
    topicScope:      row['topic_scope'] as string,
    dimension:       row['dimension'] as DivergenceDimension,
    status:          row['status'] as BreachStatus,
    evidence:        row['evidence'] as BreachEvidence,
    breachedAt:      row['breached_at'] as string,
    resolvedAt:      (row['resolved_at'] as string) ?? null,
  };
}

function rowToBreachSummary(row: Record<string, unknown>): EnvelopeBreachSummary {
  const evidence = row['evidence'] as BreachEvidence;
  return {
    id:         row['id'] as string,
    topicScope: row['topic_scope'] as string,
    dimension:  row['dimension'] as DivergenceDimension,
    status:     row['status'] as BreachStatus,
    severity:   evidence?.severity ?? 'minor',
    reason:     evidence?.reason   ?? '',
    breachedAt: row['breached_at'] as string,
    resolvedAt: (row['resolved_at'] as string) ?? null,
  };
}

/**
 * divergence.store.ts
 *
 * CAV Level 1 hardening — Store layer, Section 2 of Hardening Directive.
 *
 * Stateless persistence adapter for:
 *   - divergence_events table
 *
 * Rules:
 *   - Requires tenantId explicitly on every method.
 *   - No business rule logic.
 *   - Only layer allowed to call Supabase for divergence data.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { DivergenceDimension, DivergenceEvidence } from '@cav-align/core';
import { rootLogger } from '../lib/logger';

export interface DivergenceEventInsertInput {
  tenantId: string;
  dbSourceId?: string;
  dbObservedTruthId?: string;
  dimension: DivergenceDimension;
  onsetEstimatedAt: string;
  confirmedAt: string;
  evidence: DivergenceEvidence;
  deviceId?: string | null;
  userId?: string | null;
  entityType?: string | null;
}

export class DivergenceStore {
  private readonly log = rootLogger.child({ context: 'DivergenceStore' });

  constructor(private readonly supabase: SupabaseClient) {}

  async insertEvent(input: DivergenceEventInsertInput): Promise<string | undefined> {
    try {
      const { data, error } = await this.supabase
        .from('divergence_events')
        .insert({
          tenant_id:           input.tenantId,
          source_id:           input.dbSourceId ?? null,
          observed_truth_id:   input.dbObservedTruthId ?? null,
          dimension:           input.dimension,
          status:              'confirmed',
          onset_estimated_at:  input.onsetEstimatedAt,
          confirmed_at:        input.confirmedAt,
          evidence:            input.evidence,
          device_id:           input.deviceId ?? null,
          user_id:             input.userId ?? null,
          entity_type:         input.entityType ?? null,
        })
        .select('id')
        .single();

      if (error) {
        this.log.error('insertEvent failed', error, { tenantId: input.tenantId });
        return undefined;
      }

      this.log.info('Divergence event persisted', {
        tenantId:  input.tenantId,
        dimension: input.dimension,
        eventId:   data?.id,
      });

      return data?.id as string | undefined;
    } catch (err) {
      this.log.error('insertEvent exception', err);
      return undefined;
    }
  }

  async resolveEvent(input: {
    tenantId: string;
    dbEventId: string;
    resolvedAt: string;
  }): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('divergence_events')
        .update({ status: 'resolved', resolved_at: input.resolvedAt })
        .eq('id', input.dbEventId)
        .eq('tenant_id', input.tenantId);

      if (error) {
        this.log.error('resolveEvent failed', error, { tenantId: input.tenantId });
        return;
      }

      this.log.info('Divergence event resolved', {
        tenantId: input.tenantId,
        eventId:  input.dbEventId,
      });
    } catch (err) {
      this.log.error('resolveEvent exception', err);
    }
  }
}

// ---------------------------------------------------------------------------
// Read methods (user-scoped — respects RLS)
// ---------------------------------------------------------------------------

import { buildUserClient } from '../lib/supabase-client';

export interface DivergenceEventFilters {
  status?:    string;
  dimension?: string;
}

export interface DivergenceEventDto {
  id:               string;
  dimension:        string;
  status:           string;
  sourceIdentifier: string | null;
  onsetEstimatedAt: string;
  confirmedAt:      string | null;
  resolvedAt:       string | null;
  evidence:         unknown;
  deviceId:         string | null;
}

export async function listDivergenceEvents(
  token: string,
  filters: DivergenceEventFilters = {},
): Promise<DivergenceEventDto[]> {
  const supabase = buildUserClient(token);
  if (!supabase) return [];

  let query = supabase
    .from('divergence_events')
    .select(`
      id, dimension, status, onset_estimated_at, confirmed_at, resolved_at,
      evidence, device_id,
      sources!inner(source_identifier, tenant_id)
    `)
    .order('onset_estimated_at', { ascending: false })
    .limit(100);

  if (filters.status)    query = query.eq('status',    filters.status);
  if (filters.dimension) query = query.eq('dimension', filters.dimension);

  const { data, error } = await query;

  if (error) {
    rootLogger.error('listDivergenceEvents failed', error);
    throw new Error('Failed to fetch divergence events');
  }

  return (data ?? []).map((row: Record<string, unknown>) => {
    const source = row['sources'] as Record<string, unknown> | null;
    return {
      id:               row['id'] as string,
      dimension:        row['dimension'] as string,
      status:           row['status'] as string,
      sourceIdentifier: (source?.['source_identifier'] as string) ?? null,
      onsetEstimatedAt: row['onset_estimated_at'] as string,
      confirmedAt:      (row['confirmed_at'] as string) ?? null,
      resolvedAt:       (row['resolved_at'] as string) ?? null,
      evidence:         row['evidence'],
      deviceId:         (row['device_id'] as string) ?? null,
    };
  });
}

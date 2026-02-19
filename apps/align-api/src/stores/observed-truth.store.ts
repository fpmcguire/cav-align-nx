/**
 * observed-truth.store.ts
 *
 * CAV Level 1 hardening — Store layer, Section 2 of Hardening Directive.
 *
 * Stateless persistence adapter for:
 *   - sources table
 *   - observed_truths table
 *
 * Rules:
 *   - Requires tenantId explicitly on every method.
 *   - No business rule logic.
 *   - Only layer allowed to call Supabase for OT/sources data.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ObservedTruth } from '@cav-align/core';
import { rootLogger } from '../lib/logger';

export interface SourceUpsertInput {
  tenantId: string;
  connectionId: string;
  protocol: string;
  sourceIdentifier: string;
  sourceIdentifierHash: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface SourceUpdateCountInput {
  tenantId: string;
  dbSourceId: string;
  messageCount: number;
  lastMessageAt: string;
}

export interface ObservedTruthInsertInput {
  tenantId: string;
  dbSourceId: string;
  ot: ObservedTruth;
}

export class ObservedTruthStore {
  private readonly log = rootLogger.child({ context: 'ObservedTruthStore' });

  constructor(private readonly supabase: SupabaseClient) {}

  async upsertSource(input: SourceUpsertInput): Promise<string | undefined> {
    try {
      const { data, error } = await this.supabase
        .from('sources')
        .upsert(
          {
            tenant_id:              input.tenantId,
            connection_id:          input.connectionId,
            session_id:             input.connectionId,
            protocol:               input.protocol,
            source_identifier_hash: input.sourceIdentifierHash,
            source_identifier:      input.sourceIdentifier,
            status:                 'discovering',
            first_seen_at:          input.firstSeenAt,
            last_message_at:        input.lastSeenAt,
            message_count:          0,
          },
          { onConflict: 'tenant_id,session_id,source_identifier_hash', ignoreDuplicates: false },
        )
        .select('id')
        .single();

      if (error) {
        this.log.error('upsertSource failed', error, { tenantId: input.tenantId });
        return undefined;
      }
      return data?.id as string | undefined;
    } catch (err) {
      this.log.error('upsertSource exception', err, { tenantId: input.tenantId });
      return undefined;
    }
  }

  async updateSourceCount(input: SourceUpdateCountInput): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('sources')
        .update({
          message_count:   input.messageCount,
          last_message_at: input.lastMessageAt,
        })
        .eq('id', input.dbSourceId)
        .eq('tenant_id', input.tenantId);

      if (error) {
        this.log.error('updateSourceCount failed', error, { tenantId: input.tenantId });
      }
    } catch (err) {
      this.log.error('updateSourceCount exception', err);
    }
  }

  async insertObservedTruth(input: ObservedTruthInsertInput): Promise<string | undefined> {
    try {
      const { data, error } = await this.supabase
        .from('observed_truths')
        .insert({
          tenant_id:       input.tenantId,
          source_id:       input.dbSourceId,
          shape:           input.ot.shape,
          cadence:         input.ot.cadence,
          domain:          input.ot.domain,
          sample_size:     input.ot.establishmentSampleSize,
          established_at:  input.ot.establishedAt,
          last_updated_at: input.ot.establishedAt,
        })
        .select('id')
        .single();

      if (error) {
        this.log.error('insertObservedTruth failed', error, { tenantId: input.tenantId });
        return undefined;
      }
      return data?.id as string | undefined;
    } catch (err) {
      this.log.error('insertObservedTruth exception', err);
      return undefined;
    }
  }

  async markSourceEstablished(input: {
    tenantId: string;
    dbSourceId: string;
    dbObservedTruthId: string;
  }): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('sources')
        .update({
          observed_truth_id: input.dbObservedTruthId,
          status:            'established',
        })
        .eq('id', input.dbSourceId)
        .eq('tenant_id', input.tenantId);

      if (error) {
        this.log.error('markSourceEstablished failed', error, { tenantId: input.tenantId });
      }
    } catch (err) {
      this.log.error('markSourceEstablished exception', err);
    }
  }
}

// ---------------------------------------------------------------------------
// Read methods (user-scoped — respects RLS)
// ---------------------------------------------------------------------------

import { buildUserClient } from '../lib/supabase-client';

export interface SourceDto {
  id:             string;
  sourceIdentifier: string;
  status:         string;
  lastMessageAt:  string | null;
  messageCount:   number;
}

export async function listSources(token: string): Promise<SourceDto[]> {
  const supabase = buildUserClient(token);
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('sources')
    .select('id, source_identifier, status, last_message_at, message_count')
    .order('last_message_at', { ascending: false });

  if (error) {
    rootLogger.error('listSources failed', error);
    throw new Error('Failed to fetch sources');
  }

  return (data ?? []).map((row: Record<string, unknown>) => ({
    id:               row['id'] as string,
    sourceIdentifier: row['source_identifier'] as string,
    status:           row['status'] as string,
    lastMessageAt:    (row['last_message_at'] as string) ?? null,
    messageCount:     (row['message_count'] as number) ?? 0,
  }));
}

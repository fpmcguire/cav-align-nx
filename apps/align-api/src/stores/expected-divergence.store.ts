/**
 * expected-divergence.store.ts
 *
 * CAV Level 1 hardening — Store layer, Section 2 of Hardening Directive.
 *
 * Stateless persistence adapter for:
 *   - expected_divergences table (engine-side operations only)
 *
 * Note: CREATE / CANCEL operations remain in the route/service layer
 * because they are user-initiated and require the user-scoped Supabase client.
 * This store handles matcher operations using the service-role client.
 *
 * Rules:
 *   - Requires tenantId explicitly on every method.
 *   - No business rule logic.
 *   - Only layer allowed to call Supabase for expected-divergence data (engine side).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { rootLogger } from '../lib/logger';

export interface PendingExpectationRow {
  id: string;
  topic: string;
  identity_scope: string | null;
  expected_dimensions: string[];
  window_start: string;
  window_end: string;
  grace_minutes: number;
  matched_event_ids: string[];
}

export class ExpectedDivergenceStore {
  private readonly log = rootLogger.child({ context: 'ExpectedDivergenceStore' });

  constructor(private readonly supabase: SupabaseClient) {}

  async fetchPending(tenantId: string): Promise<PendingExpectationRow[]> {
    try {
      const { data, error } = await this.supabase
        .from('expected_divergences')
        .select('id, topic, identity_scope, expected_dimensions, window_start, window_end, grace_minutes, matched_event_ids')
        .eq('tenant_id', tenantId)
        .eq('status', 'pending');

      if (error) {
        this.log.error('fetchPending failed', error, { tenantId });
        return [];
      }
      return (data ?? []) as PendingExpectationRow[];
    } catch (err) {
      this.log.error('fetchPending exception', err, { tenantId });
      return [];
    }
  }

  async confirmExpectation(input: {
    tenantId: string;
    id: string;
    eventId: string;
    existingMatchedIds: string[];
  }): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('expected_divergences')
        .update({
          status:            'confirmed',
          matched_event_ids: [...input.existingMatchedIds, input.eventId],
          resolved_at:       new Date().toISOString(),
        })
        .eq('id', input.id)
        .eq('tenant_id', input.tenantId);

      if (error) {
        this.log.error('confirmExpectation failed', error, { tenantId: input.tenantId });
        return;
      }

      this.log.info('Expectation confirmed', {
        tenantId:     input.tenantId,
        expectationId: input.id,
        eventId:       input.eventId,
      });
    } catch (err) {
      this.log.error('confirmExpectation exception', err);
    }
  }

  async markExpiredAsMissed(tenantId: string): Promise<void> {
    try {
      const { data, error } = await this.supabase
        .from('expected_divergences')
        .select('id, window_end, grace_minutes')
        .eq('tenant_id', tenantId)
        .eq('status', 'pending');

      if (error || !data) return;

      const now = Date.now();
      const expiredIds = (data as { id: string; window_end: string; grace_minutes: number }[])
        .filter((r) => now > new Date(r.window_end).getTime() + r.grace_minutes * 60_000)
        .map((r) => r.id);

      if (expiredIds.length === 0) return;

      const { error: updateError } = await this.supabase
        .from('expected_divergences')
        .update({ status: 'missed', resolved_at: new Date().toISOString() })
        .in('id', expiredIds)
        .eq('tenant_id', tenantId);

      if (updateError) {
        this.log.error('markExpiredAsMissed update failed', updateError, { tenantId });
        return;
      }

      this.log.info('Marked expectations as missed', {
        tenantId,
        count: expiredIds.length,
      });
    } catch (err) {
      this.log.error('markExpiredAsMissed exception', err);
    }
  }
}

/**
 * convergence-action.store.ts
 *
 * CAV Level 6 scaffolding (measure-only) — Store layer for convergence_actions table.
 *
 * INVARIANTS (architecture plan v0.2 §4.4):
 *   - Actions are user-logged only. takenBy is required (NOT NULL in DB).
 *   - No automated process may create a ConvergenceAction.
 *   - The system may retrospectively link postActionDeltaId once a new
 *     delta is computed after the action's actionTakenAt timestamp.
 *   - No webhooks, remediation handlers, or policy adapters in v2.
 *
 * NOT marketable as Level 6 — convergence enforcement is v4.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ConvergenceAction,
  ConvergenceEffectiveness,
} from '@cav-align/core';
import { rootLogger } from '../lib/logger';

export interface CreateActionInput {
  tenantId:       string;
  breachId:       string;
  description:    string;
  actionTakenAt:  string;  // ISO 8601 — when the external action occurred
  takenBy:        string;  // User UUID — required, from req.tenantContext.user.id
}

export class ConvergenceActionStore {
  private readonly log = rootLogger.child({ context: 'ConvergenceActionStore' });

  constructor(private readonly supabase: SupabaseClient) {}

  async create(input: CreateActionInput): Promise<ConvergenceAction | undefined> {
    try {
      const { data, error } = await this.supabase
        .from('convergence_actions')
        .insert({
          tenant_id:             input.tenantId,
          breach_id:             input.breachId,
          description:           input.description,
          action_taken_at:       input.actionTakenAt,
          taken_by:              input.takenBy,
          post_action_delta_id:  null,
          effectiveness:         'unknown' as ConvergenceEffectiveness,
        })
        .select()
        .single();

      if (error) {
        this.log.error('create failed', error, { tenantId: input.tenantId });
        return undefined;
      }

      this.log.info('Convergence action logged', {
        tenantId: input.tenantId,
        breachId: input.breachId,
        actionId: data?.id,
      });

      return rowToAction(data as Record<string, unknown>);
    } catch (err) {
      this.log.error('create exception', err);
      return undefined;
    }
  }

  async listForBreach(tenantId: string, breachId: string): Promise<ConvergenceAction[]> {
    try {
      const { data, error } = await this.supabase
        .from('convergence_actions')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('breach_id', breachId)
        .order('action_taken_at', { ascending: false });

      if (error) {
        this.log.error('listForBreach failed', error, { tenantId, breachId });
        throw new Error('Failed to list convergence actions');
      }

      return (data ?? []).map((r) => rowToAction(r as Record<string, unknown>));
    } catch (err) {
      this.log.error('listForBreach exception', err, { tenantId, breachId });
      throw err;
    }
  }

  /**
   * Retrospectively links the post-action delta and updates effectiveness.
   * Called by the orchestrator when a new delta is computed after an action's
   * actionTakenAt timestamp — the only automated write this store performs.
   */
  async linkPostActionDelta(
    tenantId:  string,
    actionId:  string,
    deltaId:   string,
    effectiveness: ConvergenceEffectiveness,
  ): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('convergence_actions')
        .update({ post_action_delta_id: deltaId, effectiveness })
        .eq('id', actionId)
        .eq('tenant_id', tenantId)
        .is('post_action_delta_id', null);  // Only update if not already linked

      if (error) {
        this.log.error('linkPostActionDelta failed', error, { tenantId, actionId });
      }
    } catch (err) {
      this.log.error('linkPostActionDelta exception', err, { tenantId, actionId });
    }
  }
}

function rowToAction(row: Record<string, unknown>): ConvergenceAction {
  return {
    id:                  row['id'] as string,
    tenantId:            row['tenant_id'] as string,
    breachId:            row['breach_id'] as string,
    description:         row['description'] as string,
    actionTakenAt:       row['action_taken_at'] as string,
    takenBy:             row['taken_by'] as string,
    postActionDeltaId:   (row['post_action_delta_id'] as string) ?? null,
    effectiveness:       row['effectiveness'] as ConvergenceEffectiveness,
    createdAt:           row['created_at'] as string,
  };
}

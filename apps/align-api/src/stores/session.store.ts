/**
 * session.store.ts
 *
 * CAV Level 1 hardening — Store layer, Section 2 of Hardening Directive.
 *
 * Stateless persistence adapter for:
 *   - alignment_sessions table lifecycle
 *
 * Records ingestion session start/stop/health per the Hardening Directive
 * Section 3 operational credibility requirements.
 *
 * Rules:
 *   - Requires tenantId explicitly on every method.
 *   - No business rule logic.
 *   - Only layer allowed to call Supabase for session data.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { rootLogger } from '../lib/logger';

export type SessionHealth = 'healthy' | 'degraded' | 'stalled';

export interface SessionStartInput {
  tenantId: string;
  connectionId: string;
  protocol: string;
  startedAt: string;
}

export interface SessionStopInput {
  tenantId: string;
  connectionId: string;
  stoppedAt: string;
  health: SessionHealth;
  messageCount: number;
}

export class SessionStore {
  private readonly log = rootLogger.child({ context: 'SessionStore' });

  constructor(private readonly supabase: SupabaseClient) {}

  async startSession(input: SessionStartInput): Promise<string | undefined> {
    try {
      const { data, error } = await this.supabase
        .from('alignment_sessions')
        .upsert(
          {
            id:            input.connectionId,
            tenant_id:     input.tenantId,
            protocol:      input.protocol,
            status:        'active',
            started_at:    input.startedAt,
            health:        'healthy',
            message_count: 0,
          },
          { onConflict: 'id' },
        )
        .select('id')
        .single();

      if (error) {
        this.log.error('startSession failed', error, { tenantId: input.tenantId });
        return undefined;
      }

      this.log.info('Session started', {
        tenantId:     input.tenantId,
        connectionId: input.connectionId,
        protocol:     input.protocol,
      });

      return data?.id as string | undefined;
    } catch (err) {
      this.log.error('startSession exception', err);
      return undefined;
    }
  }

  async stopSession(input: SessionStopInput): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('alignment_sessions')
        .update({
          status:        'stopped',
          stopped_at:    input.stoppedAt,
          health:        input.health,
          message_count: input.messageCount,
        })
        .eq('id', input.connectionId)
        .eq('tenant_id', input.tenantId);

      if (error) {
        this.log.error('stopSession failed', error, { tenantId: input.tenantId });
        return;
      }

      this.log.info('Session stopped', {
        tenantId:     input.tenantId,
        connectionId: input.connectionId,
        health:       input.health,
      });
    } catch (err) {
      this.log.error('stopSession exception', err);
    }
  }

  async updateHealth(input: {
    tenantId: string;
    connectionId: string;
    health: SessionHealth;
    messageCount: number;
  }): Promise<void> {
    try {
      await this.supabase
        .from('alignment_sessions')
        .update({ health: input.health, message_count: input.messageCount })
        .eq('id', input.connectionId)
        .eq('tenant_id', input.tenantId);
    } catch (err) {
      this.log.error('updateHealth exception', err);
    }
  }
}

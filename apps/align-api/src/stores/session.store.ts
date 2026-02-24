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
  sessionId: string;
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
        .insert({
          tenant_id:     input.tenantId,
          connection_id: input.connectionId,
          protocol:      input.protocol,
          status:        'active',
          started_at:    input.startedAt,
          health:        'healthy',
          message_count: 0,
        })
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
        .eq('id', input.sessionId)
        .eq('tenant_id', input.tenantId);

      if (error) {
        this.log.error('stopSession failed', error, { tenantId: input.tenantId });
        return;
      }

      this.log.info('Session stopped', {
        tenantId:  input.tenantId,
        sessionId: input.sessionId,
        health:    input.health,
      });
    } catch (err) {
      this.log.error('stopSession exception', err);
    }
  }

  async updateHealth(input: {
    tenantId: string;
    sessionId: string;
    health: SessionHealth;
    messageCount: number;
  }): Promise<void> {
    try {
      await this.supabase
        .from('alignment_sessions')
        .update({ health: input.health, message_count: input.messageCount })
        .eq('id', input.sessionId)
        .eq('tenant_id', input.tenantId);
    } catch (err) {
      this.log.error('updateHealth exception', err);
    }
  }

  // ── Query methods ────────────────────────────────────────────────────────

  async listSessions(tenantId: string): Promise<unknown[]> {
    try {
      const { data, error } = await this.supabase
        .from('alignment_sessions')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('started_at', { ascending: false });

      if (error) {
        this.log.error('listSessions failed', error, { tenantId });
        return [];
      }

      return data || [];
    } catch (err) {
      this.log.error('listSessions exception', err);
      return [];
    }
  }

  async getSession(tenantId: string, sessionId: string): Promise<unknown | null> {
    try {
      const { data, error } = await this.supabase
        .from('alignment_sessions')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('id', sessionId)
        .single();

      if (error) {
        this.log.error('getSession failed', error, { tenantId, sessionId });
        return null;
      }

      return data;
    } catch (err) {
      this.log.error('getSession exception', err);
      return null;
    }
  }
}

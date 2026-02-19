/**
 * observed-truth-engine.ts
 *
 * CAV Level 1 — Observed Truth Inference Engine.
 *
 * Ingests NormalizedMessages, builds Shape / Cadence / Domain profiles,
 * and establishes Observed Truth once the criteria are met.
 *
 * Persistence: Supabase (observed_truths, sources tables).
 * Broadcast:   WebSocket (topic:status-changed).
 */

import type { NormalizedMessage, ObservedTruth } from '@cav-align/core';
import { DEFAULT_ALIGN_CONFIG } from '@cav-align/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AlignWebSocketServer } from '../../websocket/websocket-server';
import { ShapeAggregator } from './shape-extractor';
import { CadenceAccumulator } from './cadence-calculator';
import { DomainProfiler } from './domain-profiler';

export interface OtUpdateResult {
  sourceId: string;
  established: boolean;
  observedTruth?: ObservedTruth;
  dbObservedTruthId?: string;
  dbSourceId?: string;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface SourceInferenceState {
  tenantId: string;
  connectionId: string;
  sourceId: string;
  protocol: string;
  firstSeenAt: string;
  lastSeenAt: string;
  messageCount: number;
  established: boolean;
  establishedAt?: string;

  shapeAggregator: ShapeAggregator;
  cadenceAccumulator: CadenceAccumulator;
  domainProfiler: DomainProfiler;
  lastMessageTimestamp: string | null;

  dbSourceId?: string;
  dbObservedTruthId?: string;
  observedTruth?: ObservedTruth;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class ObservedTruthEngine {
  private readonly sourceStates = new Map<string, SourceInferenceState>();

  constructor(
    private readonly supabase?: SupabaseClient,
    private readonly wsServer?: AlignWebSocketServer,
  ) {}

  async ingest(msg: NormalizedMessage): Promise<OtUpdateResult> {
    const key = `${msg.tenantId}:${msg.connectionId}:${msg.sourceId}`;

    let state = this.sourceStates.get(key);
    if (!state) {
      state = {
        tenantId: msg.tenantId,
        connectionId: msg.connectionId,
        sourceId: msg.sourceId,
        protocol: msg.metadata.protocol,
        firstSeenAt: msg.timestamp,
        lastSeenAt: msg.timestamp,
        messageCount: 0,
        established: false,
        shapeAggregator: new ShapeAggregator(),
        cadenceAccumulator: new CadenceAccumulator(),
        domainProfiler: new DomainProfiler(),
        lastMessageTimestamp: null,
      };
      this.sourceStates.set(key, state);
      await this.upsertSource(state);
    }

    // Update accumulators
    state.shapeAggregator.addSample(msg.payload);

    if (state.lastMessageTimestamp) {
      const intervalMs =
        new Date(msg.timestamp).getTime() -
        new Date(state.lastMessageTimestamp).getTime();
      if (intervalMs > 0) state.cadenceAccumulator.addInterval(intervalMs);
    }
    state.lastMessageTimestamp = msg.timestamp;

    state.domainProfiler.addSample(msg.payload);
    state.messageCount++;
    state.lastSeenAt = msg.timestamp;

    // Throttled DB update for message count
    if (this.supabase && state.dbSourceId && state.messageCount % 10 === 0) {
      await this.supabase
        .from('sources')
        .update({ message_count: state.messageCount, last_message_at: msg.timestamp })
        .eq('id', state.dbSourceId);
    }

    // Establishment check
    if (!state.established && this.meetsEstablishmentCriteria(state)) {
      state.established = true;
      state.establishedAt = new Date().toISOString();
      const ot = this.buildOT(state, msg.sourceId, msg.connectionId);
      state.observedTruth = ot;
      await this.persistOT(state, ot);
      this.broadcastEstablished(state);
      console.log(`[OT Engine] Established for: ${msg.sourceId}`);
    }

    // Refresh OT every 50 msgs after establishment
    if (state.established && state.messageCount % 50 === 0) {
      state.observedTruth = this.buildOT(state, msg.sourceId, msg.connectionId);
    }

    return {
      sourceId: msg.sourceId,
      established: state.established,
      observedTruth: state.observedTruth,
      dbObservedTruthId: state.dbObservedTruthId,
      dbSourceId: state.dbSourceId,
    };
  }

  private meetsEstablishmentCriteria(state: SourceInferenceState): boolean {
    const { minSampleSize, minObservationWindowMs } = DEFAULT_ALIGN_CONFIG.inference;
    if (state.messageCount < minSampleSize) return false;
    const windowMs = Date.now() - new Date(state.firstSeenAt).getTime();
    return windowMs >= minObservationWindowMs;
  }

  private buildOT(state: SourceInferenceState, sourceId: string, sessionId: string): ObservedTruth {
    return {
      id: state.dbObservedTruthId ?? crypto.randomUUID(),
      topicId: sourceId,
      sessionId,
      establishedAt: state.establishedAt ?? new Date().toISOString(),
      shape: state.shapeAggregator.buildShape(state.messageCount),
      cadence: state.cadenceAccumulator.buildCadence(),
      domain: state.domainProfiler.buildDomain(),
      establishmentSampleSize: state.messageCount,
    };
  }

  private async upsertSource(state: SourceInferenceState): Promise<void> {
    if (!this.supabase) return;
    try {
      const hash = await this.sha256(state.sourceId);
      const { data, error } = await this.supabase
        .from('sources')
        .upsert(
          {
            tenant_id: state.tenantId,
            connection_id: state.connectionId,
            session_id: state.connectionId,
            protocol: state.protocol,
            source_identifier_hash: hash,
            source_identifier: state.sourceId,
            status: 'discovering',
            first_seen_at: state.firstSeenAt,
            last_message_at: state.lastSeenAt,
            message_count: 0,
          },
          { onConflict: 'tenant_id,session_id,source_identifier_hash', ignoreDuplicates: false },
        )
        .select('id')
        .single();
      if (!error && data) state.dbSourceId = data.id as string;
    } catch (err) {
      console.error('[OT Engine] upsertSource:', err);
    }
  }

  private async persistOT(state: SourceInferenceState, ot: ObservedTruth): Promise<void> {
    if (!this.supabase) return;
    try {
      const { data, error } = await this.supabase
        .from('observed_truths')
        .insert({
          tenant_id: state.tenantId,
          source_id: state.dbSourceId,
          shape: ot.shape,
          cadence: ot.cadence,
          domain: ot.domain,
          sample_size: ot.establishmentSampleSize,
          established_at: ot.establishedAt,
          last_updated_at: ot.establishedAt,
        })
        .select('id')
        .single();

      if (!error && data) {
        state.dbObservedTruthId = data.id as string;
        state.observedTruth = { ...ot, id: data.id as string };
      }

      if (state.dbSourceId) {
        await this.supabase
          .from('sources')
          .update({ observed_truth_id: state.dbObservedTruthId, status: 'established' })
          .eq('id', state.dbSourceId);
      }
    } catch (err) {
      console.error('[OT Engine] persistOT:', err);
    }
  }

  private broadcastEstablished(state: SourceInferenceState): void {
    this.wsServer?.broadcastToSession(state.connectionId, {
      type: 'topic:status-changed',
      sessionId: state.connectionId,
      topicId: state.sourceId,
      status: 'established',
    });
  }

  private async sha256(input: string): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
}

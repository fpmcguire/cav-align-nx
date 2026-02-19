/**
 * divergence-engine.ts
 *
 * CAV Level 1 — Divergence Detection Engine.
 *
 * Detects sustained deviations from established Observed Truth.
 * State machine: nominal → accumulating → confirmed → resolved.
 *
 * Persistence: Supabase (divergence_events table).
 * Broadcast:   WebSocket (divergence:detected, divergence:resolved).
 */

import type {
  NormalizedMessage,
  ObservedTruth,
  DivergenceDimension,
  DivergenceEvidence,
  ShapeDivergenceEvidence,
  CadenceDivergenceEvidence,
  DomainDivergenceEvidence,
} from '@cav-align/core';
import { DEFAULT_ALIGN_CONFIG } from '@cav-align/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AlignWebSocketServer } from '../../websocket/websocket-server';
import { compareShapes } from '../observed-truth/shape-extractor';
import { detectCadenceDivergence, detectCadenceSilence } from '../observed-truth/cadence-calculator';
import { detectDomainDivergence } from '../observed-truth/domain-profiler';

export interface DivergenceDetectionResult {
  dimension: DivergenceDimension;
  status: 'accumulating' | 'confirmed' | 'resolved';
  dbEventId?: string;
  evidence?: DivergenceEvidence;
}

// ---------------------------------------------------------------------------
// Internal accumulation state
// ---------------------------------------------------------------------------

interface AccumulationState {
  sourceKey: string;
  tenantId: string;
  connectionId: string;
  sourceId: string;
  dimension: DivergenceDimension;
  accumulatingSince: string;
  anomalyCount: number;
  lastAnomalyAt: string;
  evidenceSamples: DivergenceEvidence[];
  confirmedAt?: string;
  dbEventId?: string;
  // For resolution tracking
  consecutiveNominalCount: number;
}

// Per-source cadence tracking (needs last message time per source)
interface CadenceTrackingState {
  lastMessageAt: string;
}

// ---------------------------------------------------------------------------
// DivergenceEngine
// ---------------------------------------------------------------------------

export class DivergenceEngine {
  private readonly accumulations = new Map<string, AccumulationState>();
  private readonly cadenceTrackers = new Map<string, CadenceTrackingState>();

  constructor(
    private readonly supabase?: SupabaseClient,
    private readonly wsServer?: AlignWebSocketServer,
  ) {}

  async detect(
    msg: NormalizedMessage,
    ot: ObservedTruth,
    dbSourceId?: string,
    dbObservedTruthId?: string,
  ): Promise<DivergenceDetectionResult[]> {
    const results: DivergenceDetectionResult[] = [];

    // --- Shape ---
    const shapeResult = this.detectShape(msg, ot);
    if (shapeResult) {
      const r = await this.processAnomaly(msg, 'shape', shapeResult, dbSourceId, dbObservedTruthId);
      if (r) results.push(r);
    } else {
      const r = this.processNominal(msg, 'shape');
      if (r) results.push(r);
    }

    // --- Cadence ---
    const cadenceEvidence = this.detectCadence(msg, ot);
    if (cadenceEvidence) {
      const r = await this.processAnomaly(msg, 'cadence', cadenceEvidence, dbSourceId, dbObservedTruthId);
      if (r) results.push(r);
    } else {
      const r = this.processNominal(msg, 'cadence');
      if (r) results.push(r);
    }

    // --- Domain ---
    const domainEvidence = this.detectDomain(msg, ot);
    if (domainEvidence) {
      const r = await this.processAnomaly(msg, 'domain', domainEvidence, dbSourceId, dbObservedTruthId);
      if (r) results.push(r);
    } else {
      const r = this.processNominal(msg, 'domain');
      if (r) results.push(r);
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Per-dimension detection
  // ---------------------------------------------------------------------------

  private detectShape(
    msg: NormalizedMessage,
    ot: ObservedTruth,
  ): ShapeDivergenceEvidence | null {
    const comparison = compareShapes(msg.payload, ot.shape.topLevelFields);
    if (!comparison.hasChanges) return null;

    // Use first change as evidence
    if (comparison.removedFields.length > 0) {
      const path = comparison.removedFields[0];
      const established = ot.shape.topLevelFields.find((f) => f.path === path);
      return {
        dimension: 'shape',
        affectedFieldPath: path,
        expectedType: established?.observedType,
        expectedPresenceRate: established?.presenceRate ?? 1,
        observedPresenceRate: 0,
        changeKind: 'field-disappeared',
      };
    }
    if (comparison.addedFields.length > 0) {
      const path = comparison.addedFields[0];
      return {
        dimension: 'shape',
        affectedFieldPath: path,
        expectedPresenceRate: 0,
        observedPresenceRate: 1,
        changeKind: 'field-appeared',
      };
    }
    if (comparison.typeChanges.length > 0) {
      const change = comparison.typeChanges[0];
      return {
        dimension: 'shape',
        affectedFieldPath: change.path,
        expectedType: change.expectedType,
        observedType: change.observedType,
        expectedPresenceRate: 1,
        observedPresenceRate: 1,
        changeKind: 'type-changed',
      };
    }
    return null;
  }

  private detectCadence(
    msg: NormalizedMessage,
    ot: ObservedTruth,
  ): CadenceDivergenceEvidence | null {
    const sourceKey = `${msg.tenantId}:${msg.connectionId}:${msg.sourceId}`;
    const tracker = this.cadenceTrackers.get(sourceKey);

    if (tracker) {
      const intervalMs =
        new Date(msg.timestamp).getTime() - new Date(tracker.lastMessageAt).getTime();
      const result = detectCadenceDivergence(
        intervalMs,
        ot.cadence,
        DEFAULT_ALIGN_CONFIG.detection.cadenceStaleStdDevMultiplier,
      );
      tracker.lastMessageAt = msg.timestamp;

      if (result.isDivergent && result.changeKind) {
        return {
          dimension: 'cadence',
          expectedMeanIntervalMs: ot.cadence.meanIntervalMs,
          observedMeanIntervalMs: result.observedIntervalMs,
          expectedP95IntervalMs: ot.cadence.p95IntervalMs,
          observedP95IntervalMs: result.observedIntervalMs,
          changeKind: result.changeKind,
        };
      }
    } else {
      this.cadenceTrackers.set(sourceKey, { lastMessageAt: msg.timestamp });
    }

    // Silence check (runs regardless)
    if (detectCadenceSilence(msg.timestamp, ot.cadence, DEFAULT_ALIGN_CONFIG.detection.cadenceStaleStdDevMultiplier)) {
      return {
        dimension: 'cadence',
        expectedMeanIntervalMs: ot.cadence.meanIntervalMs,
        observedMeanIntervalMs: 0,
        expectedP95IntervalMs: ot.cadence.p95IntervalMs,
        observedP95IntervalMs: 0,
        changeKind: 'silent',
      };
    }

    return null;
  }

  private detectDomain(
    msg: NormalizedMessage,
    ot: ObservedTruth,
  ): DomainDivergenceEvidence | null {
    const result = detectDomainDivergence(
      msg.payload,
      ot.domain,
      DEFAULT_ALIGN_CONFIG.detection.domainOutOfRangeStdDevMultiplier,
    );
    if (!result.isDivergent || !result.changeKind || !result.fieldPath) return null;

    const numericProfile = ot.domain.numericFields.find(
      (f) => f.fieldPath === result.fieldPath,
    );

    return {
      dimension: 'domain',
      affectedFieldPath: result.fieldPath,
      changeKind: result.changeKind,
      expectedRange: numericProfile
        ? { min: numericProfile.min, max: numericProfile.max, p5: numericProfile.p5, p95: numericProfile.p95 }
        : undefined,
      observedValue: result.observedValue,
    };
  }

  // ---------------------------------------------------------------------------
  // Accumulation state machine
  // ---------------------------------------------------------------------------

  private accumKey(msg: NormalizedMessage, dimension: DivergenceDimension): string {
    return `${msg.tenantId}:${msg.connectionId}:${msg.sourceId}:${dimension}`;
  }

  private async processAnomaly(
    msg: NormalizedMessage,
    dimension: DivergenceDimension,
    evidence: DivergenceEvidence,
    dbSourceId?: string,
    dbObservedTruthId?: string,
  ): Promise<DivergenceDetectionResult | null> {
    const key = this.accumKey(msg, dimension);
    const { confirmationMessageCount, confirmationWindowMs } = DEFAULT_ALIGN_CONFIG.detection;

    let accum = this.accumulations.get(key);

    if (!accum) {
      // Start accumulating
      accum = {
        sourceKey: key,
        tenantId: msg.tenantId,
        connectionId: msg.connectionId,
        sourceId: msg.sourceId,
        dimension,
        accumulatingSince: msg.timestamp,
        anomalyCount: 1,
        lastAnomalyAt: msg.timestamp,
        evidenceSamples: [evidence],
        consecutiveNominalCount: 0,
      };
      this.accumulations.set(key, accum);
      return { dimension, status: 'accumulating', evidence };
    }

    // Already accumulating — check if window expired
    const windowMs =
      new Date(msg.timestamp).getTime() - new Date(accum.accumulatingSince).getTime();

    if (windowMs > confirmationWindowMs && accum.anomalyCount < confirmationMessageCount) {
      // Window expired without confirmation — reset
      this.accumulations.delete(key);
      return null;
    }

    // Already confirmed — just return existing event
    if (accum.confirmedAt) {
      accum.consecutiveNominalCount = 0;
      return { dimension, status: 'confirmed', dbEventId: accum.dbEventId, evidence };
    }

    accum.anomalyCount++;
    accum.lastAnomalyAt = msg.timestamp;
    accum.consecutiveNominalCount = 0;
    if (accum.evidenceSamples.length < 10) {
      accum.evidenceSamples.push(evidence);
    }

    if (accum.anomalyCount >= confirmationMessageCount) {
      accum.confirmedAt = msg.timestamp;
      const dbEventId = await this.persistDivergenceEvent(msg, accum, evidence, dbSourceId, dbObservedTruthId);
      accum.dbEventId = dbEventId;
      this.broadcastDivergenceDetected(msg, accum, evidence);
      console.log(`[DivergenceEngine] CONFIRMED ${dimension} divergence for ${msg.sourceId}`);
      return { dimension, status: 'confirmed', dbEventId, evidence };
    }

    return { dimension, status: 'accumulating', evidence };
  }

  private processNominal(
    msg: NormalizedMessage,
    dimension: DivergenceDimension,
  ): DivergenceDetectionResult | null {
    const key = this.accumKey(msg, dimension);
    const accum = this.accumulations.get(key);

    if (!accum) return null;

    accum.consecutiveNominalCount++;
    const { resolutionWindowMs, confirmationWindowMs } = DEFAULT_ALIGN_CONFIG.detection;

    // Use confirmationWindowMs to approximate number of nominal messages needed
    const nominalThreshold = Math.max(
      DEFAULT_ALIGN_CONFIG.detection.confirmationMessageCount,
      Math.ceil(resolutionWindowMs / confirmationWindowMs) * 2,
    );

    if (accum.consecutiveNominalCount >= nominalThreshold) {
      const wasConfirmed = !!accum.confirmedAt;
      const dbEventId = accum.dbEventId;
      this.accumulations.delete(key);

      if (wasConfirmed) {
        this.resolveEvent(msg, dbEventId);
        return { dimension, status: 'resolved', dbEventId };
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Supabase persistence
  // ---------------------------------------------------------------------------

  private async persistDivergenceEvent(
    msg: NormalizedMessage,
    accum: AccumulationState,
    evidence: DivergenceEvidence,
    dbSourceId?: string,
    dbObservedTruthId?: string,
  ): Promise<string | undefined> {
    if (!this.supabase) return undefined;

    try {
      const { data, error } = await this.supabase
        .from('divergence_events')
        .insert({
          tenant_id: msg.tenantId,
          source_id: dbSourceId,
          observed_truth_id: dbObservedTruthId,
          dimension: accum.dimension,
          status: 'confirmed',
          onset_estimated_at: accum.accumulatingSince,
          confirmed_at: accum.confirmedAt,
          evidence,
          device_id: msg.identityHints?.deviceId ?? null,
          user_id: msg.identityHints?.userId ?? null,
          entity_type: msg.identityHints?.entityType ?? null,
        })
        .select('id')
        .single();

      if (error) {
        console.error('[DivergenceEngine] persist event:', error.message);
        return undefined;
      }
      return data?.id as string | undefined;
    } catch (err) {
      console.error('[DivergenceEngine] persistDivergenceEvent:', err);
      return undefined;
    }
  }

  private async resolveEvent(msg: NormalizedMessage, dbEventId?: string): Promise<void> {
    if (!this.supabase || !dbEventId) return;
    await this.supabase
      .from('divergence_events')
      .update({ status: 'resolved', resolved_at: msg.timestamp })
      .eq('id', dbEventId);

    this.wsServer?.broadcastToSession(msg.connectionId, {
      type: 'divergence:resolved',
      sessionId: msg.connectionId,
      eventId: dbEventId,
    });
  }

  private broadcastDivergenceDetected(
    msg: NormalizedMessage,
    accum: AccumulationState,
    evidence: DivergenceEvidence,
  ): void {
    this.wsServer?.broadcastToSession(msg.connectionId, {
      type: 'divergence:detected',
      sessionId: msg.connectionId,
      event: {
        id: accum.dbEventId ?? crypto.randomUUID(),
        topicPath: msg.sourceId,
        dimension: accum.dimension,
        status: 'confirmed',
        confirmedAt: accum.confirmedAt,
        changeKind: ('changeKind' in evidence ? evidence.changeKind : 'unknown') as string,
      },
    });
  }
}

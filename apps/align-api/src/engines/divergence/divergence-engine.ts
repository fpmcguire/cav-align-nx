/**
 * divergence-engine.ts
 *
 * CAV Level 1 — Divergence Detection Engine.
 *
 * PURE COMPUTATION ONLY — no Supabase, no tenant resolution, no side effects.
 * Returns structured DivergenceDetectionResult[]; persistence and broadcasting
 * are handled by the orchestrator via DivergenceStore and AlignWebSocketServer.
 *
 * CAV Level 1 hardening — Section 2 of Hardening Directive.
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
import { compareShapes } from '../observed-truth/shape-extractor';
import { detectCadenceDivergence, detectCadenceSilence } from '../observed-truth/cadence-calculator';
import { detectDomainDivergence } from '../observed-truth/domain-profiler';

export type DivergenceResultStatus = 'accumulating' | 'confirmed' | 'resolved';

export interface DivergenceDetectionResult {
  dimension: DivergenceDimension;
  status: DivergenceResultStatus;
  /** Populated on first confirmation — used by orchestrator for persistence */
  newlyConfirmed?: {
    tenantId: string;
    sourceId: string;
    connectionId: string;
    onsetEstimatedAt: string;
    confirmedAt: string;
    evidence: DivergenceEvidence;
    deviceId?: string | null;
    userId?: string | null;
    entityType?: string | null;
  };
  /** DB event ID — written back by orchestrator after store.insertEvent() */
  dbEventId?: string;
  /** Set when status === 'resolved' */
  resolvedEventId?: string;
}

// ---------------------------------------------------------------------------
// Internal accumulation state
// ---------------------------------------------------------------------------

interface AccumulationState {
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
  consecutiveNominalCount: number;
}

interface CadenceTrackingState {
  lastMessageAt: string;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class DivergenceEngine {
  private readonly accumulations = new Map<string, AccumulationState>();
  private readonly cadenceTrackers = new Map<string, CadenceTrackingState>();

  detect(
    msg: NormalizedMessage,
    ot: ObservedTruth,
  ): DivergenceDetectionResult[] {
    const results: DivergenceDetectionResult[] = [];

    // Shape
    const shapeEvidence = this.detectShape(msg, ot);
    const shapeResult = shapeEvidence
      ? this.processAnomaly(msg, 'shape', shapeEvidence)
      : this.processNominal(msg, 'shape');
    if (shapeResult) results.push(shapeResult);

    // Cadence
    const cadenceEvidence = this.detectCadence(msg, ot);
    const cadenceResult = cadenceEvidence
      ? this.processAnomaly(msg, 'cadence', cadenceEvidence)
      : this.processNominal(msg, 'cadence');
    if (cadenceResult) results.push(cadenceResult);

    // Domain
    const domainEvidence = this.detectDomain(msg, ot);
    const domainResult = domainEvidence
      ? this.processAnomaly(msg, 'domain', domainEvidence)
      : this.processNominal(msg, 'domain');
    if (domainResult) results.push(domainResult);

    return results;
  }

  /** Called by orchestrator after persisting a confirmed event */
  setDbEventId(msg: NormalizedMessage, dimension: DivergenceDimension, dbEventId: string): void {
    const key = this.accumKey(msg, dimension);
    const accum = this.accumulations.get(key);
    if (accum) accum.dbEventId = dbEventId;
  }

  // ---------------------------------------------------------------------------
  // Per-dimension detection (pure)
  // ---------------------------------------------------------------------------

  private detectShape(msg: NormalizedMessage, ot: ObservedTruth): ShapeDivergenceEvidence | null {
    const comparison = compareShapes(msg.payload, ot.shape.topLevelFields);
    if (!comparison.hasChanges) return null;

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
      return {
        dimension: 'shape',
        affectedFieldPath: comparison.addedFields[0],
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

  private detectCadence(msg: NormalizedMessage, ot: ObservedTruth): CadenceDivergenceEvidence | null {
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

  private detectDomain(msg: NormalizedMessage, ot: ObservedTruth): DomainDivergenceEvidence | null {
    const result = detectDomainDivergence(
      msg.payload,
      ot.domain,
      DEFAULT_ALIGN_CONFIG.detection.domainOutOfRangeStdDevMultiplier,
    );
    if (!result.isDivergent || !result.changeKind || !result.fieldPath) return null;

    const numericProfile = ot.domain.numericFields.find((f) => f.fieldPath === result.fieldPath);

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
  // Accumulation state machine (pure — no async)
  // ---------------------------------------------------------------------------

  private accumKey(msg: NormalizedMessage, dimension: DivergenceDimension): string {
    return `${msg.tenantId}:${msg.connectionId}:${msg.sourceId}:${dimension}`;
  }

  private processAnomaly(
    msg: NormalizedMessage,
    dimension: DivergenceDimension,
    evidence: DivergenceEvidence,
  ): DivergenceDetectionResult | null {
    const key = this.accumKey(msg, dimension);
    const { confirmationMessageCount, confirmationWindowMs } = DEFAULT_ALIGN_CONFIG.detection;

    let accum = this.accumulations.get(key);

    if (!accum) {
      accum = {
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
      return { dimension, status: 'accumulating' };
    }

    const windowMs =
      new Date(msg.timestamp).getTime() - new Date(accum.accumulatingSince).getTime();

    if (windowMs > confirmationWindowMs && accum.anomalyCount < confirmationMessageCount) {
      this.accumulations.delete(key);
      return null;
    }

    if (accum.confirmedAt) {
      accum.consecutiveNominalCount = 0;
      return { dimension, status: 'confirmed', dbEventId: accum.dbEventId };
    }

    accum.anomalyCount++;
    accum.lastAnomalyAt = msg.timestamp;
    accum.consecutiveNominalCount = 0;
    if (accum.evidenceSamples.length < 10) accum.evidenceSamples.push(evidence);

    if (accum.anomalyCount >= confirmationMessageCount) {
      accum.confirmedAt = msg.timestamp;
      return {
        dimension,
        status: 'confirmed',
        newlyConfirmed: {
          tenantId:          msg.tenantId,
          sourceId:          msg.sourceId,
          connectionId:      msg.connectionId,
          onsetEstimatedAt:  accum.accumulatingSince,
          confirmedAt:       accum.confirmedAt,
          evidence,
          deviceId:          msg.identityHints?.deviceId ?? null,
          userId:            msg.identityHints?.userId ?? null,
          entityType:        msg.identityHints?.entityType ?? null,
        },
      };
    }

    return { dimension, status: 'accumulating' };
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
    const nominalThreshold = Math.max(
      DEFAULT_ALIGN_CONFIG.detection.confirmationMessageCount,
      Math.ceil(resolutionWindowMs / confirmationWindowMs) * 2,
    );

    if (accum.consecutiveNominalCount >= nominalThreshold) {
      const wasConfirmed = !!accum.confirmedAt;
      const dbEventId    = accum.dbEventId;
      this.accumulations.delete(key);

      if (wasConfirmed) {
        return { dimension, status: 'resolved', resolvedEventId: dbEventId };
      }
    }

    return null;
  }
}

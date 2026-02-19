/**
 * observed-truth-engine.ts
 *
 * CAV Level 1 — Observed Truth Inference Engine.
 *
 * PURE COMPUTATION ONLY — no Supabase, no tenant resolution, no side effects.
 * Returns structured OtUpdateResult; persistence is handled by the orchestrator
 * via ObservedTruthStore.
 *
 * CAV Level 1 hardening — Section 2 of Hardening Directive.
 */

import type { NormalizedMessage, ObservedTruth } from '@cav-align/core';
import { DEFAULT_ALIGN_CONFIG } from '@cav-align/core';
import { ShapeAggregator } from './shape-extractor';
import { CadenceAccumulator } from './cadence-calculator';
import { DomainProfiler } from './domain-profiler';

export interface OtUpdateResult {
  sourceId: string;
  established: boolean;
  justEstablished: boolean;
  isNew: boolean;
  observedTruth?: ObservedTruth;
  dbSourceId?: string;
  dbObservedTruthId?: string;
}

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

export class ObservedTruthEngine {
  private readonly sourceStates = new Map<string, SourceInferenceState>();

  static stateKey(msg: NormalizedMessage): string {
    return `${msg.tenantId}:${msg.connectionId}:${msg.sourceId}`;
  }

  ingest(msg: NormalizedMessage): OtUpdateResult {
    const key = ObservedTruthEngine.stateKey(msg);
    let state = this.sourceStates.get(key);
    const isNew = !state;

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
    }

    state.shapeAggregator.addSample(msg.payload);

    if (state.lastMessageTimestamp) {
      const intervalMs =
        new Date(msg.timestamp).getTime() - new Date(state.lastMessageTimestamp).getTime();
      if (intervalMs > 0) state.cadenceAccumulator.addInterval(intervalMs);
    }
    state.lastMessageTimestamp = msg.timestamp;
    state.domainProfiler.addSample(msg.payload);
    state.messageCount++;
    state.lastSeenAt = msg.timestamp;

    let justEstablished = false;
    if (!state.established && this.meetsEstablishmentCriteria(state)) {
      state.established = true;
      state.establishedAt = new Date().toISOString();
      justEstablished = true;
      state.observedTruth = this.buildOT(state);
    }

    if (state.established && !justEstablished && state.messageCount % 50 === 0) {
      state.observedTruth = this.buildOT(state);
    }

    return {
      sourceId: msg.sourceId,
      established: state.established,
      justEstablished,
      isNew,
      observedTruth: state.observedTruth,
      dbSourceId: state.dbSourceId,
      dbObservedTruthId: state.dbObservedTruthId,
    };
  }

  setDbSourceId(msg: NormalizedMessage, dbSourceId: string): void {
    const state = this.sourceStates.get(ObservedTruthEngine.stateKey(msg));
    if (state) state.dbSourceId = dbSourceId;
  }

  setDbObservedTruthId(msg: NormalizedMessage, dbObservedTruthId: string): void {
    const state = this.sourceStates.get(ObservedTruthEngine.stateKey(msg));
    if (state) {
      state.dbObservedTruthId = dbObservedTruthId;
      if (state.observedTruth) {
        state.observedTruth = { ...state.observedTruth, id: dbObservedTruthId };
      }
    }
  }

  shouldUpdateCount(msg: NormalizedMessage): boolean {
    const state = this.sourceStates.get(ObservedTruthEngine.stateKey(msg));
    return !!state && state.messageCount % 10 === 0 && !!state.dbSourceId;
  }

  getMessageCount(msg: NormalizedMessage): number {
    return this.sourceStates.get(ObservedTruthEngine.stateKey(msg))?.messageCount ?? 0;
  }

  private meetsEstablishmentCriteria(state: SourceInferenceState): boolean {
    const { minSampleSize, minObservationWindowMs } = DEFAULT_ALIGN_CONFIG.inference;
    if (state.messageCount < minSampleSize) return false;
    return Date.now() - new Date(state.firstSeenAt).getTime() >= minObservationWindowMs;
  }

  private buildOT(state: SourceInferenceState): ObservedTruth {
    return {
      id: state.dbObservedTruthId ?? crypto.randomUUID(),
      topicId: state.sourceId,
      sessionId: state.connectionId,
      establishedAt: state.establishedAt ?? new Date().toISOString(),
      shape: state.shapeAggregator.buildShape(state.messageCount),
      cadence: state.cadenceAccumulator.buildCadence(),
      domain: state.domainProfiler.buildDomain(),
      establishmentSampleSize: state.messageCount,
    };
  }
}

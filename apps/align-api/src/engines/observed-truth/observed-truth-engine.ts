/**
 * observed-truth-engine.ts
 *
 * CAV Level 1 - Observed Truth Inference Engine
 *
 * Continuously derives Observed Truth across three dimensions:
 *   - Shape: Structural fingerprint of JSON payloads
 *   - Cadence: Temporal pattern of message arrival
 *   - Domain: Value ranges and categorical profiles
 *
 * This is the core intelligence of CAV-Align.
 */

import type { NormalizedMessage, ObservedTruth } from '@cav-align/core';

export interface OtUpdateResult {
  sourceId: string;
  established: boolean;
  observedTruth?: ObservedTruth;
}

/**
 * The Observed Truth inference engine.
 * 
 * TODO (Step 4 continuation):
 *   - Implement Shape extraction (field paths, types, presence rates)
 *   - Implement Cadence statistics (inter-arrival quantiles)
 *   - Implement Domain profiling (numeric ranges, categorical values)
 *   - Implement OT establishment logic (sample count + time window)
 *   - Persist to Supabase
 */
export class ObservedTruthEngine {
  // In-memory state for OT inference (will move to Supabase)
  private readonly sourceStates = new Map<string, SourceInferenceState>();

  /**
   * Ingest a normalized message and update Observed Truth.
   */
  async ingest(msg: NormalizedMessage): Promise<OtUpdateResult> {
    const sourceKey = this.getSourceKey(msg.tenantId, msg.connectionId, msg.sourceId);
    
    let state = this.sourceStates.get(sourceKey);
    if (!state) {
      state = this.createSourceState(msg);
      this.sourceStates.set(sourceKey, state);
    }

    // Update inference state
    this.updateShapeInference(state, msg.payload);
    this.updateCadenceInference(state, msg.timestamp);
    this.updateDomainInference(state, msg.payload);

    state.messageCount++;

    // Check if OT should be established
    const shouldEstablish = this.shouldEstablishOT(state);
    
    if (shouldEstablish && !state.established) {
      state.established = true;
      state.establishedAt = new Date().toISOString();
      
      // TODO: Build ObservedTruth object from state
      // TODO: Persist to Supabase
      
      console.log(`[ObservedTruthEngine] OT established for source: ${msg.sourceId}`);
    }

    return {
      sourceId: msg.sourceId,
      established: state.established,
      // observedTruth: state.established ? this.buildOT(state) : undefined,
    };
  }

  private getSourceKey(tenantId: string, connectionId: string, sourceId: string): string {
    return `${tenantId}:${connectionId}:${sourceId}`;
  }

  private createSourceState(msg: NormalizedMessage): SourceInferenceState {
    return {
      tenantId: msg.tenantId,
      connectionId: msg.connectionId,
      sourceId: msg.sourceId,
      protocol: msg.metadata.protocol,
      firstSeenAt: msg.timestamp,
      lastSeenAt: msg.timestamp,
      messageCount: 0,
      established: false,
      
      // Shape state
      observedFields: new Map(),
      
      // Cadence state
      interArrivalTimes: [],
      lastMessageTimestamp: null,
      
      // Domain state
      numericFields: new Map(),
      categoricalFields: new Map(),
    };
  }

  private updateShapeInference(state: SourceInferenceState, payload: unknown): void {
    // TODO: Implement Shape extraction
    // - Extract field paths from JSON payload
    // - Track field types (string, number, boolean, null, object, array)
    // - Track presence rates per field
    // - Detect structural variants
  }

  private updateCadenceInference(state: SourceInferenceState, timestamp: string): void {
    // TODO: Implement Cadence statistics
    // - Calculate inter-arrival time from last message
    // - Maintain rolling window of intervals
    // - Compute mean, stddev, p5, p95, min, max
    
    if (state.lastMessageTimestamp) {
      const lastMs = new Date(state.lastMessageTimestamp).getTime();
      const currentMs = new Date(timestamp).getTime();
      const intervalMs = currentMs - lastMs;
      
      state.interArrivalTimes.push(intervalMs);
      
      // Keep only last 1000 intervals (configurable)
      if (state.interArrivalTimes.length > 1000) {
        state.interArrivalTimes.shift();
      }
    }
    
    state.lastMessageTimestamp = timestamp;
  }

  private updateDomainInference(state: SourceInferenceState, payload: unknown): void {
    // TODO: Implement Domain profiling
    // - Extract numeric fields and track min/max/mean/stddev
    // - Extract categorical fields and track observed values
    // - Handle nullability rates
  }

  private shouldEstablishOT(state: SourceInferenceState): boolean {
    // TODO: Implement establishment criteria from DEFAULT_ALIGN_CONFIG
    // - minSampleSize (default: 30 messages)
    // - minObservationWindowMs (default: 60 seconds)
    
    const hasEnoughMessages = state.messageCount >= 30;
    const firstSeenMs = new Date(state.firstSeenAt).getTime();
    const now = Date.now();
    const observationWindowMs = now - firstSeenMs;
    const hasEnoughTime = observationWindowMs >= 60_000;
    
    return hasEnoughMessages && hasEnoughTime;
  }
}

/**
 * Internal state tracked per source during OT inference.
 */
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
  
  // Shape inference state
  observedFields: Map<string, FieldInferenceState>;
  
  // Cadence inference state
  interArrivalTimes: number[];
  lastMessageTimestamp: string | null;
  
  // Domain inference state
  numericFields: Map<string, NumericFieldState>;
  categoricalFields: Map<string, CategoricalFieldState>;
}

interface FieldInferenceState {
  path: string;
  observedType: string;
  presenceCount: number;
}

interface NumericFieldState {
  path: string;
  values: number[];
  min: number;
  max: number;
}

interface CategoricalFieldState {
  path: string;
  observedValues: Set<string>;
}

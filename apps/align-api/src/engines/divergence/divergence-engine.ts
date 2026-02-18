/**
 * divergence-engine.ts
 *
 * CAV Level 1 - Divergence Detection Engine
 *
 * Detects sustained deviations from established Observed Truth across:
 *   - Shape: Structural changes (field added/removed/type changed)
 *   - Cadence: Temporal pattern changes (faster/slower/irregular/silent)
 *   - Domain: Value range excursions or unexpected categorical values
 *
 * Enforces the "sustained" requirement:
 *   - Single anomalous message ≠ divergence
 *   - Must accumulate evidence over qualification window
 *   - Transitions: nominal → accumulating → confirmed → resolved
 */

import type {
  NormalizedMessage,
  ObservedTruth,
  DivergenceEvent,
  DivergenceDimension,
} from '@cav-align/core';

export interface DivergenceDetectionResult {
  dimension: DivergenceDimension;
  status: 'accumulating' | 'confirmed' | 'resolved';
  event?: DivergenceEvent;
}

/**
 * The Divergence detection engine.
 * 
 * TODO (Step 4 continuation):
 *   - Implement Shape divergence detection (key mismatches, type changes)
 *   - Implement Cadence divergence detection (out-of-band intervals, silence)
 *   - Implement Domain divergence detection (value excursions)
 *   - Implement qualification window logic (accumulating → confirmed)
 *   - Implement resolution detection (diverged → resolved)
 *   - Persist divergence events to Supabase
 */
export class DivergenceEngine {
  // In-memory accumulation state (will move to Supabase)
  private readonly accumulationStates = new Map<string, DivergenceAccumulationState>();

  /**
   * Detect divergence by comparing a message against established OT.
   * Returns divergence info if detected, null otherwise.
   */
  async detect(
    msg: NormalizedMessage,
    ot: ObservedTruth
  ): Promise<DivergenceDetectionResult | null> {
    // TODO: Implement per-dimension divergence checks
    
    // Check Shape divergence
    const shapeDivergence = this.detectShapeDivergence(msg.payload, ot);
    
    // Check Cadence divergence
    const cadenceDivergence = this.detectCadenceDivergence(msg.timestamp, ot);
    
    // Check Domain divergence
    const domainDivergence = this.detectDomainDivergence(msg.payload, ot);
    
    // Return first detected divergence (priority: Shape > Cadence > Domain)
    return shapeDivergence || cadenceDivergence || domainDivergence;
  }

  private detectShapeDivergence(
    payload: unknown,
    ot: ObservedTruth
  ): DivergenceDetectionResult | null {
    // TODO: Implement Shape divergence detection
    // - Extract current field structure from payload
    // - Compare against ot.shape.topLevelFields
    // - Detect: field additions, field removals, type changes
    // - Check if deviation is sustained (accumulation logic)
    
    return null; // Stub
  }

  private detectCadenceDivergence(
    timestamp: string,
    ot: ObservedTruth
  ): DivergenceDetectionResult | null {
    // TODO: Implement Cadence divergence detection
    // - Calculate inter-arrival time from last message
    // - Compare against ot.cadence (mean, stddev, p5, p95)
    // - Detect: faster, slower, irregular, silent
    // - Check if deviation is sustained
    
    return null; // Stub
  }

  private detectDomainDivergence(
    payload: unknown,
    ot: ObservedTruth
  ): DivergenceDetectionResult | null {
    // TODO: Implement Domain divergence detection
    // - Extract numeric field values
    // - Compare against ot.domain.numericFields (min, max, mean, stddev)
    // - Extract categorical field values
    // - Compare against ot.domain.categoricalFields (observedValues)
    // - Detect: out-of-range, unexpected-value, type-mismatch
    // - Check if deviation is sustained
    
    return null; // Stub
  }
}

/**
 * Internal state for tracking divergence accumulation.
 * Divergence must be sustained (not just a single anomaly) to be confirmed.
 */
interface DivergenceAccumulationState {
  sourceId: string;
  dimension: DivergenceDimension;
  accumulatingSince: string;
  anomalyCount: number;
  confirmedAt?: string;
  resolvedAt?: string;
}

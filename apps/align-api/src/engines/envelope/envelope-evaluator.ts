/**
 * envelope-evaluator.ts
 *
 * CAV Level 4 — Envelope Evaluator
 *
 * PURE COMPUTATION ONLY — no Supabase, no side effects.
 *
 * Determines whether a DeltaResult breaches the tolerance envelope
 * defined in the active IntentVersion, and classifies severity.
 *
 * Severity thresholds (architecture plan v0.2 §5.3):
 *   minor:    delta > tolerance and <= 1.5x tolerance
 *   moderate: delta > 1.5x tolerance and <= 2x tolerance
 *   critical: delta > 2x tolerance
 *
 * Tolerance is expressed as a dimensionless threshold (0.0–1.0).
 * It is derived from the IntentDefinition's tolerancePct/threshold fields.
 */

import type {
  DeltaResult,
  EnvelopeAssessment,
  BreachSeverity,
  BreachEvidence,
} from '@cav-align/core';

import type {
  IntentDefinition,
  ShapeIntentDefinition,
  CadenceIntentDefinition,
} from '@cav-align/core';

export class EnvelopeEvaluator {
  /**
   * Evaluate whether the delta breaches the intent envelope.
   *
   * @param delta    The computed DeltaResult from DeltaEngine
   * @param envelope The IntentDefinition that defines the tolerance
   */
  evaluate(delta: DeltaResult, envelope: IntentDefinition): EnvelopeAssessment {
    const tolerance = this.extractTolerance(envelope);
    const value     = delta.value;

    // Perfect alignment or within tolerance — no breach
    if (value <= tolerance) {
      return {
        breached:  false,
        severity:  'minor',  // Not meaningful when breached = false
        evidence:  this.buildEvidence(delta, value, tolerance, 'minor'),
      };
    }

    const severity = this.classifySeverity(value, tolerance);
    const evidence = this.buildEvidence(delta, value, tolerance, severity);

    return { breached: true, severity, evidence };
  }

  // ---------------------------------------------------------------------------
  // Tolerance extraction — dimension-specific
  // ---------------------------------------------------------------------------

  /**
   * Derives a normalised tolerance threshold (0.0–1.0) from the IntentDefinition.
   *
   * Shape:   1 - allowedFieldOptionalityThreshold (e.g. 0.8 threshold → 0.2 tolerance)
   * Cadence: tolerancePct / 100 (e.g. 20% → 0.20)
   * Domain:  fixed 5% tolerance unless overridden (domain constraints are binary by nature)
   */
  private extractTolerance(def: IntentDefinition): number {
    if ('requiredFields' in def) {
      // Shape: tolerance = fraction of fields allowed to be below threshold
      const shapeDef = def as ShapeIntentDefinition;
      return clamp(1 - shapeDef.allowedFieldOptionalityThreshold, 0.0, 1.0);
    }

    if ('expectedMeanIntervalMs' in def) {
      // Cadence: tolerance = tolerancePct expressed as 0–1
      const cadenceDef = def as CadenceIntentDefinition;
      return clamp(cadenceDef.tolerancePct / 100, 0.0, 1.0);
    }

    // Domain: fixed 5% tolerance (constraints are declarative; any breach is significant)
    return 0.05;
  }

  // ---------------------------------------------------------------------------
  // Severity classification
  // ---------------------------------------------------------------------------

  private classifySeverity(value: number, tolerance: number): BreachSeverity {
    if (value <= tolerance * 1.5) return 'minor';
    if (value <= tolerance * 2.0) return 'moderate';
    return 'critical';
  }

  // ---------------------------------------------------------------------------
  // Evidence builder
  // ---------------------------------------------------------------------------

  private buildEvidence(
    delta:     DeltaResult,
    value:     number,
    tolerance: number,
    severity:  BreachSeverity,
  ): BreachEvidence {
    return {
      deltaValue:  value,
      severity,
      reason:      delta.detail.reason,
      deltaDetail: delta.detail,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * delta-engine.ts
 *
 * CAV Level 4 — Formal Alignment Delta Engine
 *
 * PURE COMPUTATION ONLY — no Supabase, no side effects.
 *
 * Computes Delta_k(t) = D_k(i_k(t), s_k(t)) for a given dimension.
 *
 * CONTRACT (architecture plan v0.2 §5.2):
 *   - Deterministic: identical inputs always yield identical DeltaResult
 *   - Bounded: delta_value ∈ [0.0, 1.0] always
 *   - Explainable: delta_detail carries human-readable violations without ML jargon
 *   - Missing fields → full penalty for that field's weight
 *   - Unknown enum values → full penalty for that field
 *   - Monotonicity: delta_value increases with violation count
 */

import type {
  ObservedTruth,
  ObservedShape,
  ObservedCadence,
  ObservedDomain,
  ShapeField,
} from '@cav-align/core';

import type {
  DeltaResult,
  DeltaDetail,
  DeltaViolation,
  ShapeDeltaDetail,
  CadenceDeltaDetail,
  DomainDeltaDetail,
  ShapePenaltyBreakdown,
  CadencePenaltyBreakdown,
  DomainPenaltyBreakdown,
} from '@cav-align/core';

import type {
  ProjectedIntention,
  ShapeIntentDefinition,
  CadenceIntentDefinition,
  DomainIntentDefinition,
} from '@cav-align/core';

import type { DivergenceDimension } from '@cav-align/core';

export class DeltaEngine {
  /**
   * Compute Delta_k(t) for the given dimension.
   *
   * @param intent   Projected intention i_k(t) from IntentProjectionEngine
   * @param observed Observed truth s_k(t) — the established OT snapshot
   * @param dimension Which CAV dimension to evaluate
   */
  compute(
    intent:    ProjectedIntention,
    observed:  ObservedTruth,
    dimension: DivergenceDimension,
  ): DeltaResult {
    switch (dimension) {
      case 'shape':   return this.computeShape(intent, observed.shape);
      case 'cadence': return this.computeCadence(intent, observed.cadence);
      case 'domain':  return this.computeDomain(intent, observed.domain);
    }
  }

  // ---------------------------------------------------------------------------
  // Shape — weighted field penalty
  // ---------------------------------------------------------------------------

  private computeShape(intent: ProjectedIntention, shape: ObservedShape): DeltaResult {
    const def = intent.definition as ShapeIntentDefinition;
    const violations: DeltaViolation[] = [];

    const requiredCount = def.requiredFields.length;
    const fieldWeight   = requiredCount > 0 ? 1 / requiredCount : 0;

    // Build a lookup map for observed fields
    const observedFieldMap = this.buildFieldMap(shape.topLevelFields);

    let missingPenalty   = 0;
    let typePenalty      = 0;
    let forbiddenPenalty = 0;

    // Check required fields
    for (const fieldPath of def.requiredFields) {
      const observed = observedFieldMap.get(fieldPath);

      if (!observed) {
        // Field entirely absent — full penalty
        missingPenalty += fieldWeight;
        violations.push({
          fieldPath,
          kind:     'field-missing',
          expected: `present (presence rate >= ${def.allowedFieldOptionalityThreshold})`,
          observed: 'absent (presence rate = 0.0)',
          penalty:  fieldWeight,
        });
        continue;
      }

      if (observed.presenceRate < def.allowedFieldOptionalityThreshold) {
        // Field present but below threshold — partial penalty proportional to shortfall
        const shortfall = (def.allowedFieldOptionalityThreshold - observed.presenceRate)
          / def.allowedFieldOptionalityThreshold;
        const penalty = clamp(fieldWeight * shortfall, 0, fieldWeight);
        missingPenalty += penalty;
        violations.push({
          fieldPath,
          kind:     'field-missing',
          expected: `presence rate >= ${def.allowedFieldOptionalityThreshold}`,
          observed: `presence rate = ${observed.presenceRate.toFixed(2)}`,
          penalty,
        });
      }

      // Check type constraints if specified
      const allowedTypes = def.allowedTypes[fieldPath];
      if (allowedTypes && allowedTypes.length > 0) {
        if (!allowedTypes.includes(observed.observedType)) {
          typePenalty += fieldWeight;
          violations.push({
            fieldPath,
            kind:     'type-mismatch',
            expected: `type in [${allowedTypes.join(', ')}]`,
            observed: `type = ${observed.observedType}`,
            penalty:  fieldWeight,
          });
        }
      }
    }

    // Check forbidden fields
    const forbiddenCount = def.forbiddenFields.length;
    const forbiddenWeight = forbiddenCount > 0
      ? Math.min(fieldWeight, 1 / forbiddenCount)
      : 0;

    for (const fieldPath of def.forbiddenFields) {
      if (observedFieldMap.has(fieldPath)) {
        forbiddenPenalty += forbiddenWeight;
        violations.push({
          fieldPath,
          kind:     'field-forbidden',
          expected: 'absent',
          observed: 'present',
          penalty:  forbiddenWeight,
        });
      }
    }

    const value = clamp(missingPenalty + typePenalty + forbiddenPenalty, 0, 1);
    const penaltyBreakdown: ShapePenaltyBreakdown = {
      fieldMissing:   round(missingPenalty),
      fieldForbidden: round(forbiddenPenalty),
      typeMismatch:   round(typePenalty),
    };

    const detail: ShapeDeltaDetail = {
      schemaVersion:   1,
      dimension:       'shape',
      reason:          buildShapeReason(violations, value),
      violations,
      totalViolations: violations.length,
      penaltyBreakdown,
    };

    return { value: round(value), withinEnvelope: false, detail };
  }

  // ---------------------------------------------------------------------------
  // Cadence — normalised interval deviation
  // ---------------------------------------------------------------------------

  private computeCadence(intent: ProjectedIntention, cadence: ObservedCadence): DeltaResult {
    const def = intent.definition as CadenceIntentDefinition;
    const violations: DeltaViolation[] = [];

    let intervalPenalty = 0;
    let silencePenalty  = 0;
    let jitterPenalty   = 0;

    const intentMean    = def.expectedMeanIntervalMs;
    const toleranceAbs  = intentMean * (def.tolerancePct / 100);

    // Interval deviation
    const deviation = Math.abs(cadence.meanIntervalMs - intentMean);
    if (deviation > toleranceAbs) {
      intervalPenalty = clamp(deviation / intentMean, 0, 1);
      const kind: 'cadence-too-fast' | 'cadence-too-slow' =
        cadence.meanIntervalMs < intentMean ? 'cadence-too-fast' : 'cadence-too-slow';
      violations.push({
        fieldPath: 'cadence.meanIntervalMs',
        kind,
        expected:  `${intentMean}ms ± ${def.tolerancePct}%`,
        observed:  `${cadence.meanIntervalMs.toFixed(0)}ms (${((deviation / intentMean) * 100).toFixed(1)}% deviation)`,
        penalty:   intervalPenalty,
      });
    }

    // Silence detection
    if (def.maxSilenceDurationMs > 0 && cadence.maxIntervalMs > def.maxSilenceDurationMs) {
      silencePenalty = clamp(
        (cadence.maxIntervalMs - def.maxSilenceDurationMs) / def.maxSilenceDurationMs,
        0, 1,
      );
      violations.push({
        fieldPath: 'cadence.maxIntervalMs',
        kind:      'cadence-silent',
        expected:  `max silence < ${def.maxSilenceDurationMs}ms`,
        observed:  `${cadence.maxIntervalMs.toFixed(0)}ms silence observed`,
        penalty:   silencePenalty,
      });
    }

    // Jitter — coefficient of variation vs allowedJitterPct
    if (cadence.meanIntervalMs > 0) {
      const cv = (cadence.stdDevIntervalMs / cadence.meanIntervalMs) * 100;
      if (cv > def.allowedJitterPct) {
        jitterPenalty = clamp((cv - def.allowedJitterPct) / def.allowedJitterPct, 0, 1);
        violations.push({
          fieldPath: 'cadence.stdDevIntervalMs',
          kind:      'cadence-irregular',
          expected:  `jitter (CV) <= ${def.allowedJitterPct}%`,
          observed:  `jitter (CV) = ${cv.toFixed(1)}%`,
          penalty:   jitterPenalty,
        });
      }
    }

    // Blend: interval deviation is primary (60%), silence (25%), jitter (15%)
    const value = clamp(
      intervalPenalty * 0.60 + silencePenalty * 0.25 + jitterPenalty * 0.15,
      0, 1,
    );

    const penaltyBreakdown: CadencePenaltyBreakdown = {
      intervalDeviation: round(intervalPenalty * 0.60),
      silence:           round(silencePenalty  * 0.25),
      jitter:            round(jitterPenalty   * 0.15),
    };

    const detail: CadenceDeltaDetail = {
      schemaVersion:   1,
      dimension:       'cadence',
      reason:          buildCadenceReason(violations, value),
      violations,
      totalViolations: violations.length,
      penaltyBreakdown,
    };

    return { value: round(value), withinEnvelope: false, detail };
  }

  // ---------------------------------------------------------------------------
  // Domain — fraction of values outside constraints
  // ---------------------------------------------------------------------------

  private computeDomain(intent: ProjectedIntention, domain: ObservedDomain): DeltaResult {
    const def = intent.definition as DomainIntentDefinition;
    const violations: DeltaViolation[] = [];

    const totalConstraints =
      def.numericConstraints.length + def.categoricalConstraints.length;

    if (totalConstraints === 0) {
      // No constraints defined — perfect alignment by definition
      const detail: DomainDeltaDetail = {
        schemaVersion:   1,
        dimension:       'domain',
        reason:          'No domain constraints defined — alignment is perfect by default',
        violations:      [],
        totalViolations: 0,
        penaltyBreakdown: { outOfRange: 0, unexpectedValue: 0 },
      };
      return { value: 0, withinEnvelope: true, detail };
    }

    const constraintWeight = 1 / totalConstraints;
    let rangePenalty       = 0;
    let categoricalPenalty = 0;

    // Numeric constraints
    for (const constraint of def.numericConstraints) {
      const observed = domain.numericFields.find((f) => f.fieldPath === constraint.fieldPath);
      if (!observed) {
        // Field not observed — full penalty (field missing from domain profile)
        rangePenalty += constraintWeight;
        violations.push({
          fieldPath: constraint.fieldPath,
          kind:      'out-of-range',
          expected:  `field present with values in [${constraint.min}, ${constraint.max}]`,
          observed:  'field not observed in domain profile',
          penalty:   constraintWeight,
        });
        continue;
      }

      // Check if observed range overlaps with constraint range
      const breachLow  = observed.min < constraint.min;
      const breachHigh = observed.max > constraint.max;

      if (breachLow || breachHigh) {
        // Penalty proportional to how far outside the range
        const totalRange = constraint.max - constraint.min;
        const breach = Math.max(
          breachLow  ? constraint.min - observed.min : 0,
          breachHigh ? observed.max - constraint.max : 0,
        );
        const penalty = clamp(constraintWeight * (totalRange > 0 ? breach / totalRange : 1), 0, constraintWeight);
        rangePenalty += penalty;
        violations.push({
          fieldPath: constraint.fieldPath,
          kind:      'out-of-range',
          expected:  `values in [${constraint.min}, ${constraint.max}]`,
          observed:  `observed range [${observed.min}, ${observed.max}]`,
          penalty,
        });
      }
    }

    // Categorical constraints
    for (const constraint of def.categoricalConstraints) {
      const observed = domain.categoricalFields.find((f) => f.fieldPath === constraint.fieldPath);
      if (!observed) {
        categoricalPenalty += constraintWeight;
        violations.push({
          fieldPath: constraint.fieldPath,
          kind:      'unexpected-value',
          expected:  `field present with values in [${constraint.allowedValues.join(', ')}]`,
          observed:  'field not observed in domain profile',
          penalty:   constraintWeight,
        });
        continue;
      }

      const unexpectedValues = observed.observedValues.filter(
        (v) => !constraint.allowedValues.includes(v),
      );

      if (unexpectedValues.length > 0) {
        const penalty = clamp(
          constraintWeight * (unexpectedValues.length / observed.observedValues.length),
          0, constraintWeight,
        );
        categoricalPenalty += penalty;
        violations.push({
          fieldPath: constraint.fieldPath,
          kind:      'unexpected-value',
          expected:  `values in [${constraint.allowedValues.join(', ')}]`,
          observed:  `unexpected values: [${unexpectedValues.join(', ')}]`,
          penalty,
        });
      }
    }

    const value = clamp(rangePenalty + categoricalPenalty, 0, 1);
    const penaltyBreakdown: DomainPenaltyBreakdown = {
      outOfRange:      round(rangePenalty),
      unexpectedValue: round(categoricalPenalty),
    };

    const detail: DomainDeltaDetail = {
      schemaVersion:   1,
      dimension:       'domain',
      reason:          buildDomainReason(violations, value),
      violations,
      totalViolations: violations.length,
      penaltyBreakdown,
    };

    return { value: round(value), withinEnvelope: false, detail };
  }

  // ---------------------------------------------------------------------------
  // Field map builder
  // ---------------------------------------------------------------------------

  private buildFieldMap(fields: ShapeField[]): Map<string, ShapeField> {
    const map = new Map<string, ShapeField>();
    const flatten = (fs: ShapeField[], prefix = '') => {
      for (const f of fs) {
        const path = prefix ? `${prefix}.${f.path}` : f.path;
        map.set(path, f);
        if (f.childFields?.length) flatten(f.childFields, path);
      }
    };
    flatten(fields);
    return map;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round(value: number, dp = 4): number {
  return Math.round(value * 10 ** dp) / 10 ** dp;
}

function buildShapeReason(violations: DeltaViolation[], value: number): string {
  if (violations.length === 0) return 'All required fields present with correct types — shape aligned';
  const missing    = violations.filter((v) => v.kind === 'field-missing').length;
  const typeErrors = violations.filter((v) => v.kind === 'type-mismatch').length;
  const forbidden  = violations.filter((v) => v.kind === 'field-forbidden').length;
  const parts: string[] = [];
  if (missing)    parts.push(`${missing} required field${missing > 1 ? 's' : ''} missing or below threshold`);
  if (typeErrors) parts.push(`${typeErrors} type mismatch${typeErrors > 1 ? 'es' : ''}`);
  if (forbidden)  parts.push(`${forbidden} forbidden field${forbidden > 1 ? 's' : ''} present`);
  return `${parts.join('; ')} (delta = ${(value * 100).toFixed(1)}%)`;
}

function buildCadenceReason(violations: DeltaViolation[], value: number): string {
  if (violations.length === 0) return 'Message cadence within all tolerance bounds — aligned';
  const parts = violations.map((v) => {
    if (v.kind === 'cadence-too-fast') return 'publishing faster than intent';
    if (v.kind === 'cadence-too-slow') return 'publishing slower than intent';
    if (v.kind === 'cadence-silent')   return 'silence window exceeds maximum';
    if (v.kind === 'cadence-irregular') return 'jitter exceeds allowed threshold';
    return v.kind;
  });
  return `${parts.join('; ')} (delta = ${(value * 100).toFixed(1)}%)`;
}

function buildDomainReason(violations: DeltaViolation[], value: number): string {
  if (violations.length === 0) return 'All field values within declared domain constraints — aligned';
  const outOfRange      = violations.filter((v) => v.kind === 'out-of-range').length;
  const unexpected      = violations.filter((v) => v.kind === 'unexpected-value').length;
  const parts: string[] = [];
  if (outOfRange) parts.push(`${outOfRange} numeric field${outOfRange > 1 ? 's' : ''} outside declared range`);
  if (unexpected) parts.push(`${unexpected} categorical field${unexpected > 1 ? 's' : ''} with unexpected values`);
  return `${parts.join('; ')} (delta = ${(value * 100).toFixed(1)}%)`;
}

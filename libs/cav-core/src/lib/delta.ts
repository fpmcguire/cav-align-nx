/**
 * delta.ts
 *
 * CAV Level 4 — Formal Alignment Delta
 *
 * Types for the formal alignment delta computation:
 *   Delta_k(t) = D_k(i_k(t), s_k(t))
 *
 * where:
 *   i_k(t) = projected intention (from IntentProjectionEngine)
 *   s_k(t) = observed truth     (from ObservedTruthEngine)
 *   D_k    = deterministic, bounded distance function (0.0–1.0)
 *
 * DeltaEngine contract:
 *   - Deterministic: identical inputs always yield identical output.
 *   - Bounded: delta_value ∈ [0.0, 1.0]. 0.0 = perfect alignment.
 *   - Explainable: delta_detail carries human-readable evidence without ML jargon.
 */

import type { DivergenceDimension } from './divergence';

// ---------------------------------------------------------------------------
// Violation record — one entry per violated constraint
// ---------------------------------------------------------------------------

export type ViolationKind =
  | 'field-missing'
  | 'field-forbidden'
  | 'type-mismatch'
  | 'out-of-range'
  | 'unexpected-value'
  | 'cadence-too-fast'
  | 'cadence-too-slow'
  | 'cadence-irregular'
  | 'cadence-silent';

export interface DeltaViolation {
  /** Dot-notation field path. For cadence violations, use 'cadence'. */
  readonly fieldPath: string;
  readonly kind: ViolationKind;
  /** Human-readable description of what was expected. */
  readonly expected: string;
  /** Human-readable description of what was observed. */
  readonly observed: string;
  /**
   * This violation's contribution to the overall delta_value.
   * All penalties across all violations sum to delta_value.
   */
  readonly penalty: number;
}

// ---------------------------------------------------------------------------
// Penalty breakdown — per-kind subtotals
// ---------------------------------------------------------------------------

export interface ShapePenaltyBreakdown {
  readonly fieldMissing: number;
  readonly fieldForbidden: number;
  readonly typeMismatch: number;
}

export interface CadencePenaltyBreakdown {
  readonly intervalDeviation: number;
  readonly silence: number;
  readonly jitter: number;
}

export interface DomainPenaltyBreakdown {
  readonly outOfRange: number;
  readonly unexpectedValue: number;
}

// ---------------------------------------------------------------------------
// Dimension-specific delta detail
// All include schemaVersion for safe schema evolution.
// ---------------------------------------------------------------------------

export interface ShapeDeltaDetail {
  readonly schemaVersion: 1;
  readonly dimension: 'shape';
  readonly reason: string;
  readonly violations: DeltaViolation[];
  readonly totalViolations: number;
  readonly penaltyBreakdown: ShapePenaltyBreakdown;
}

export interface CadenceDeltaDetail {
  readonly schemaVersion: 1;
  readonly dimension: 'cadence';
  readonly reason: string;
  readonly violations: DeltaViolation[];
  readonly totalViolations: number;
  readonly penaltyBreakdown: CadencePenaltyBreakdown;
}

export interface DomainDeltaDetail {
  readonly schemaVersion: 1;
  readonly dimension: 'domain';
  readonly reason: string;
  readonly violations: DeltaViolation[];
  readonly totalViolations: number;
  readonly penaltyBreakdown: DomainPenaltyBreakdown;
}

export type DeltaDetail =
  | ShapeDeltaDetail
  | CadenceDeltaDetail
  | DomainDeltaDetail;

// ---------------------------------------------------------------------------
// DeltaResult — the output of DeltaEngine.compute()
// ---------------------------------------------------------------------------

/**
 * The result of a single delta computation.
 * Pure value object — not persisted directly; persisted as AlignmentDelta.
 */
export interface DeltaResult {
  /** Scalar alignment distance. 0.0 = perfect. 1.0 = maximum divergence. Always ∈ [0.0, 1.0]. */
  readonly value: number;
  /** True if value is within the tolerance envelope defined in the active IntentVersion. */
  readonly withinEnvelope: boolean;
  /** Full explainability payload. Immutable once written to DB. */
  readonly detail: DeltaDetail;
}

// ---------------------------------------------------------------------------
// AlignmentDelta — the persisted delta record
// ---------------------------------------------------------------------------

/**
 * A persisted alignment delta record in the alignment_deltas table.
 * Created by the ingestion orchestrator after each delta computation.
 */
export interface AlignmentDelta {
  readonly id: string;
  readonly tenantId: string;
  readonly intentVersionId: string;
  readonly observedTruthId: string;
  readonly topicScope: string;
  readonly dimension: DivergenceDimension;
  /** Scalar distance ∈ [0.0, 1.0]. */
  readonly deltaValue: number;
  readonly deltaDetail: DeltaDetail;
  readonly withinEnvelope: boolean;
  readonly computedAt: string;  // ISO 8601
}

/**
 * Lightweight delta summary for time-series chart views.
 */
export interface AlignmentDeltaSummary {
  readonly id: string;
  readonly dimension: DivergenceDimension;
  readonly deltaValue: number;
  readonly withinEnvelope: boolean;
  readonly computedAt: string;
}

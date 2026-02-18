/**
 * divergence.ts
 *
 * Divergence is the sustained deviation of a topic's observed behavior
 * from its established Observed Truth. It is not triggered by a single
 * anomalous message — it must be confirmed across a sustained window.
 *
 * Align distinguishes three states on the path to confirmed Divergence:
 *   - 'accumulating' : Evidence is building; not yet confirmed.
 *   - 'confirmed'    : Sustained deviation crosses the evidence threshold.
 *   - 'resolved'     : The topic has returned to OT-consistent behavior.
 */

/**
 * Which OT dimension the divergence was detected in.
 */
export type DivergenceDimension = 'shape' | 'cadence' | 'domain';

/**
 * The lifecycle of a divergence event.
 */
export type DivergenceStatus = 'accumulating' | 'confirmed' | 'resolved';

// ---------------------------------------------------------------------------
// Dimension-specific evidence
// ---------------------------------------------------------------------------

/**
 * Evidence of Shape divergence: a field that changed, appeared, or disappeared.
 */
export interface ShapeDivergenceEvidence {
  readonly dimension: 'shape';
  readonly affectedFieldPath: string;         // Dot-notation field path
  readonly expectedType?: JsonFieldTypeRef;   // OT-established type
  readonly observedType?: JsonFieldTypeRef;   // What was seen in diverging messages
  readonly expectedPresenceRate: number;      // OT-established presence rate
  readonly observedPresenceRate: number;      // Observed rate in divergence window
  readonly changeKind: 'type-changed' | 'field-appeared' | 'field-disappeared';
}

/**
 * Evidence of Cadence divergence: the inter-arrival interval has shifted.
 */
export interface CadenceDivergenceEvidence {
  readonly dimension: 'cadence';
  readonly expectedMeanIntervalMs: number;    // OT mean
  readonly observedMeanIntervalMs: number;    // Mean during divergence window
  readonly expectedP95IntervalMs: number;     // OT p95
  readonly observedP95IntervalMs: number;
  readonly changeKind: 'faster' | 'slower' | 'irregular' | 'silent';
}

/**
 * Evidence of Domain divergence: a numeric field is outside its OT range,
 * or a categorical field produced an unrecognised value.
 */
export interface DomainDivergenceEvidence {
  readonly dimension: 'domain';
  readonly affectedFieldPath: string;
  readonly changeKind: 'out-of-range' | 'unexpected-value' | 'type-mismatch';
  readonly expectedRange?: { min: number; max: number; p5: number; p95: number };
  readonly observedValue?: number | string;
}

// Union of all evidence types — used in DivergenceEvent
export type DivergenceEvidence =
  | ShapeDivergenceEvidence
  | CadenceDivergenceEvidence
  | DomainDivergenceEvidence;

// Internal reference — avoids circular import with observed-truth.ts
type JsonFieldTypeRef = import('./observed-truth').JsonFieldType;

// ---------------------------------------------------------------------------
// Divergence Event
// ---------------------------------------------------------------------------

/**
 * A DivergenceEvent records a detected, sustained deviation from OT
 * for a specific topic and dimension.
 *
 * Multiple dimensions can diverge independently and will produce separate events.
 */
export interface DivergenceEvent {
  readonly id: string;                          // UUID
  readonly topicId: string;
  readonly sessionId: string;
  readonly observedTruthId: string;             // The OT this divergence is measured against
  readonly dimension: DivergenceDimension;
  readonly status: DivergenceStatus;
  readonly evidence: DivergenceEvidence;
  readonly accumulatingAt: string;              // ISO 8601 — when evidence began building
  readonly confirmedAt?: string;                // ISO 8601 — when status became 'confirmed'
  readonly resolvedAt?: string;                 // ISO 8601 — when topic returned to baseline
  readonly messageCountAtDetection: number;     // Topic message count when first detected
}

/**
 * Lightweight summary used in divergence list views and the VS Code extension.
 */
export interface DivergenceEventSummary {
  readonly id: string;
  readonly topicPath: string;
  readonly dimension: DivergenceDimension;
  readonly status: DivergenceStatus;
  readonly confirmedAt?: string;
  readonly changeKind: string;           // Human-readable label from evidence.changeKind
}

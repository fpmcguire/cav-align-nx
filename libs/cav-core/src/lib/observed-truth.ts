/**
 * observed-truth.ts
 *
 * Observed Truth (OT) is the inferred behavioral baseline for a topic,
 * derived from sustained production behavior — not declared by users.
 *
 * OT has three dimensions:
 *   - Shape    : The structural form of the JSON payload
 *   - Cadence  : The temporal pattern of message arrival
 *   - Domain   : The value ranges and types of payload fields
 *
 * OT is established once a topic has accumulated sufficient observations
 * over a sustained window. It represents what the topic *does*, not
 * what anyone *says* it should do.
 */

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

/**
 * The type classification of a JSON field value as observed at runtime.
 */
export type JsonFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'object'
  | 'array'
  | 'mixed'; // field observed with more than one type across messages

/**
 * A single field in the inferred Shape of a JSON payload.
 * Fields are recorded to a configurable nesting depth (default: 3 levels).
 */
export interface ShapeField {
  readonly path: string;              // Dot-notation path, e.g. 'agvPosition.x'
  readonly observedType: JsonFieldType;
  readonly presenceRate: number;      // 0.0–1.0: fraction of messages containing this field
  readonly isRequired: boolean;       // true if presenceRate >= OT establishment threshold
  readonly childFields?: ShapeField[]; // Populated for 'object' type fields
}

/**
 * The Shape dimension of an Observed Truth.
 * Captures the structural fingerprint of a topic's JSON payload.
 */
export interface ObservedShape {
  readonly topLevelFields: ShapeField[];
  readonly maxDepthObserved: number;
  readonly sampleSize: number;        // Number of messages used to infer this shape
  readonly inferredAt: string;        // ISO 8601
}

// ---------------------------------------------------------------------------
// Cadence
// ---------------------------------------------------------------------------

/**
 * The Cadence dimension of an Observed Truth.
 * Captures the temporal pattern of message arrival for a topic.
 *
 * Statistics are computed over the establishment window.
 * All durations are in milliseconds.
 */
export interface ObservedCadence {
  readonly meanIntervalMs: number;         // Average time between consecutive messages
  readonly stdDevIntervalMs: number;       // Standard deviation of inter-arrival intervals
  readonly p5IntervalMs: number;           // 5th percentile  — lower bound of normal range
  readonly p95IntervalMs: number;          // 95th percentile — upper bound of normal range
  readonly minIntervalMs: number;          // Fastest observed interval
  readonly maxIntervalMs: number;          // Slowest observed interval
  readonly sampleSize: number;             // Number of intervals used
  readonly inferredAt: string;             // ISO 8601
}

// ---------------------------------------------------------------------------
// Domain
// ---------------------------------------------------------------------------

/**
 * The observed value profile for a single numeric field.
 * Used to establish the Domain dimension for quantitative payload fields.
 */
export interface NumericFieldProfile {
  readonly fieldPath: string;           // Dot-notation path
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly stdDev: number;
  readonly p5: number;
  readonly p95: number;
  readonly sampleSize: number;
}

/**
 * The observed value set for a single string field.
 * Recorded when cardinality is low enough to be meaningful (enum-like fields).
 */
export interface CategoricalFieldProfile {
  readonly fieldPath: string;
  readonly observedValues: string[];    // Distinct values seen
  readonly isOpenSet: boolean;          // true if cardinality exceeded the tracking limit
  readonly sampleSize: number;
}

/**
 * The Domain dimension of an Observed Truth.
 * Captures the value ranges and categorical profiles of payload fields.
 */
export interface ObservedDomain {
  readonly numericFields: NumericFieldProfile[];
  readonly categoricalFields: CategoricalFieldProfile[];
  readonly sampleSize: number;
  readonly inferredAt: string;          // ISO 8601
}

// ---------------------------------------------------------------------------
// Observed Truth (composite)
// ---------------------------------------------------------------------------

/**
 * The full Observed Truth for a topic — the inferred behavioral baseline
 * across all three dimensions.
 *
 * Once established, OT is the reference against which all subsequent
 * messages are evaluated for Divergence.
 */
export interface ObservedTruth {
  readonly id: string;                  // UUID
  readonly topicId: string;
  readonly sessionId: string;
  readonly establishedAt: string;       // ISO 8601 — when OT transitioned from inferring to active
  readonly shape: ObservedShape;
  readonly cadence: ObservedCadence;
  readonly domain: ObservedDomain;
  readonly establishmentSampleSize: number; // Total messages observed before OT was established
}

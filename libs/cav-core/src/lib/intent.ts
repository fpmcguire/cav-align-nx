/**
 * intent.ts
 *
 * CAV Level 3 — Intent Registry
 *
 * Types for versioned, time-addressable intent artifacts.
 * Intent artifacts declare what a topic *should* do across one dimension.
 * They are compared against ObservedTruth to produce formal alignment deltas.
 *
 * Key invariants:
 *   - Each artifact covers exactly one dimension.
 *   - topic_scope uses MQTT wildcard syntax (+ and #).
 *   - Only one version per artifact may have status 'active' at any time.
 *   - Draft versions never trigger delta computation.
 *   - All IntentDefinition payloads carry schemaVersion for safe migration.
 */

import type { DivergenceDimension } from './divergence';

// ---------------------------------------------------------------------------
// Artifact status
// ---------------------------------------------------------------------------

export type IntentArtifactStatus = 'draft' | 'active' | 'archived';

// ---------------------------------------------------------------------------
// Version status
// ---------------------------------------------------------------------------

export type IntentVersionStatus = 'draft' | 'active' | 'superseded';

// ---------------------------------------------------------------------------
// Intent definitions (dimension-specific JSONB payloads)
// All include schemaVersion as first field for safe schema evolution.
// ---------------------------------------------------------------------------

/**
 * Shape intent: declares which fields must be present, their types,
 * and which fields are forbidden.
 */
export interface ShapeIntentDefinition {
  readonly schemaVersion: 1;
  /** Field paths (dot-notation) that must be present at or above optionality threshold. */
  readonly requiredFields: string[];
  /** Minimum presence rate (0.0–1.0) for a field to be considered present. Default: 0.8 */
  readonly allowedFieldOptionalityThreshold: number;
  /** Field paths that must never appear. */
  readonly forbiddenFields: string[];
  /** Per-field type constraints. Field paths not listed here are unconstrained. */
  readonly allowedTypes: Record<string, string[]>;
}

/**
 * Cadence intent: declares the expected temporal pattern of message arrival.
 */
export interface CadenceIntentDefinition {
  readonly schemaVersion: 1;
  /** Expected mean inter-arrival interval in milliseconds. */
  readonly expectedMeanIntervalMs: number;
  /** Acceptable deviation from expectedMeanIntervalMs as a percentage (0–100). */
  readonly tolerancePct: number;
  /** Maximum allowed silence duration before cadence is considered broken, in ms. */
  readonly maxSilenceDurationMs: number;
  /** Acceptable jitter (coefficient of variation) as a percentage (0–100). */
  readonly allowedJitterPct: number;
}

/**
 * Domain intent: declares value constraints for numeric and categorical fields.
 */
export interface NumericConstraint {
  readonly fieldPath: string;
  readonly min: number;
  readonly max: number;
}

export interface CategoricalConstraint {
  readonly fieldPath: string;
  /** Exhaustive set of allowed values. Any observed value outside this set is a violation. */
  readonly allowedValues: string[];
}

export interface DomainIntentDefinition {
  readonly schemaVersion: 1;
  readonly numericConstraints: NumericConstraint[];
  readonly categoricalConstraints: CategoricalConstraint[];
}

/** Discriminated union of all intent definition variants. */
export type IntentDefinition =
  | ShapeIntentDefinition
  | CadenceIntentDefinition
  | DomainIntentDefinition;

// ---------------------------------------------------------------------------
// Intent Version
// ---------------------------------------------------------------------------

/**
 * A single immutable version of an intent artifact.
 * Versions are created as drafts and explicitly activated.
 * Activating a new version atomically supersedes the prior active version.
 */
export interface IntentVersion {
  readonly id: string;
  readonly artifactId: string;
  readonly tenantId: string;
  readonly versionNumber: number;
  readonly definition: IntentDefinition;
  readonly status: IntentVersionStatus;
  /** ISO 8601. Required for activation — version is not active until this time. */
  readonly effectiveFrom: string;
  /** ISO 8601. Set automatically when this version is superseded. Null if still active. */
  readonly effectiveUntil: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
}

/**
 * Lightweight version summary for history list views.
 */
export interface IntentVersionSummary {
  readonly id: string;
  readonly versionNumber: number;
  readonly status: IntentVersionStatus;
  readonly effectiveFrom: string;
  readonly effectiveUntil: string | null;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// Intent Artifact
// ---------------------------------------------------------------------------

/**
 * An intent artifact declares the expected behaviour of a topic for one dimension.
 * It is the parent record for a series of versioned definitions.
 */
export interface IntentArtifact {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  /** MQTT wildcard pattern (+ and #). Matched at ingest-time. */
  readonly topicScope: string;
  readonly dimension: DivergenceDimension;
  /**
   * Tie-breaking precedence when multiple artifacts match the same topic+dimension.
   * Higher value wins. Default: 0.
   */
  readonly precedence: number;
  readonly currentVersion: number;
  readonly status: IntentArtifactStatus;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Artifact summary for list views — includes active version inline.
 */
export interface IntentArtifactSummary {
  readonly id: string;
  readonly name: string;
  readonly topicScope: string;
  readonly dimension: DivergenceDimension;
  readonly precedence: number;
  readonly status: IntentArtifactStatus;
  readonly currentVersion: number;
  readonly activeVersionId: string | null;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Projected Intention
// ---------------------------------------------------------------------------

/**
 * The result of IntentProjectionEngine.project().
 *
 * Represents i_k(t) — the declared intention for dimension k at time t.
 * Used by the DeltaEngine to compute Delta_k(t) = D_k(i_k(t), s_k(t)).
 *
 * null is returned (not this type) if:
 *   - No active version exists for the topic+dimension at the given time
 *   - The version is in 'draft' status
 */
export interface ProjectedIntention {
  readonly intentVersionId: string;
  readonly artifactId: string;
  readonly topicScope: string;
  readonly dimension: DivergenceDimension;
  readonly definition: IntentDefinition;
  readonly effectiveFrom: string;
  readonly effectiveUntil: string | null;
  readonly projectedAt: string;  // ISO 8601 — the timestamp used for projection
}

// ---------------------------------------------------------------------------
// API request/response types
// ---------------------------------------------------------------------------

export interface CreateIntentArtifactRequest {
  readonly name: string;
  readonly topicScope: string;
  readonly dimension: DivergenceDimension;
  readonly precedence?: number;
}

export interface CreateIntentVersionRequest {
  readonly definition: IntentDefinition;
  readonly effectiveFrom: string;
}

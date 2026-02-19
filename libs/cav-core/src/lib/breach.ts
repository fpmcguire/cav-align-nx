/**
 * breach.ts
 *
 * CAV Level 4 — Envelope Breach Events
 * CAV Level 6 — Convergence Actions (measure-only; not enforcement)
 *
 * EnvelopeBreach: created when a delta computation produces withinEnvelope = false.
 * Resolved when a subsequent computation for the same (tenant, topic, dimension,
 * intent_version) produces withinEnvelope = true.
 *
 * ConvergenceAction: a user-logged record that a corrective action was taken.
 * The system NEVER creates convergence actions automatically.
 * The system MAY retrospectively link post_action_delta_id once a new delta
 * is computed after the action was logged.
 *
 * Level 6 marketing note:
 *   Convergence actions are scaffolding only. They are NOT marketable as
 *   "Level 6 — Convergence Enforcement" until v4.
 */

import type { DivergenceDimension } from './divergence';
import type { DeltaDetail } from './delta';

// ---------------------------------------------------------------------------
// Breach severity
// ---------------------------------------------------------------------------

/**
 * Severity thresholds (relative to intent envelope tolerance, default in v2):
 *   minor:    delta > tolerance and <= 1.5x tolerance
 *   moderate: delta > 1.5x tolerance and <= 2x tolerance
 *   critical: delta > 2x tolerance
 */
export type BreachSeverity = 'minor' | 'moderate' | 'critical';

// ---------------------------------------------------------------------------
// Breach evidence — snapshot of delta_detail at breach onset
// ---------------------------------------------------------------------------

/**
 * Immutable evidence record captured at the moment a breach is first opened.
 * Stored in the envelope_breaches table for audit purposes.
 * Based on DeltaDetail from the triggering delta.
 */
export interface BreachEvidence {
  /** The delta_value that triggered the breach. */
  readonly deltaValue: number;
  readonly severity: BreachSeverity;
  /** Human-readable reason string from the triggering DeltaDetail. */
  readonly reason: string;
  /** Full delta detail snapshot — immutable audit trail. */
  readonly deltaDetail: DeltaDetail;
}

// ---------------------------------------------------------------------------
// EnvelopeAssessment — output of EnvelopeEvaluator.evaluate()
// ---------------------------------------------------------------------------

/**
 * The result of evaluating whether a DeltaResult breaches the intent envelope.
 * Pure value object — produced by EnvelopeEvaluator, not persisted directly.
 */
export interface EnvelopeAssessment {
  readonly breached: boolean;
  /** Only meaningful when breached = true. */
  readonly severity: BreachSeverity;
  readonly evidence: BreachEvidence;
}

// ---------------------------------------------------------------------------
// EnvelopeBreach — the persisted breach event
// ---------------------------------------------------------------------------

export type BreachStatus = 'active' | 'resolved';

/**
 * A persisted envelope breach event in the envelope_breaches table.
 * Lifecycle: active → resolved (when delta returns within envelope).
 */
export interface EnvelopeBreach {
  readonly id: string;
  readonly tenantId: string;
  readonly intentVersionId: string;
  readonly firstDeltaId: string;
  readonly topicScope: string;
  readonly dimension: DivergenceDimension;
  readonly status: BreachStatus;
  /** Immutable snapshot of evidence at breach onset. */
  readonly evidence: BreachEvidence;
  readonly breachedAt: string;      // ISO 8601
  readonly resolvedAt: string | null;  // ISO 8601 or null if still active
}

/**
 * Lightweight breach summary for list views and WS frames.
 */
export interface EnvelopeBreachSummary {
  readonly id: string;
  readonly topicScope: string;
  readonly dimension: DivergenceDimension;
  readonly status: BreachStatus;
  readonly severity: BreachSeverity;
  readonly reason: string;
  readonly breachedAt: string;
  readonly resolvedAt: string | null;
}

// ---------------------------------------------------------------------------
// ConvergenceAction — user-logged corrective action record
// ---------------------------------------------------------------------------

/**
 * Effectiveness assessment — computed retrospectively by comparing the
 * post-action delta to the breach delta.
 *
 * converging: post-action delta_value is lower than breach delta_value
 * stable:     post-action delta_value is unchanged (within 5% tolerance)
 * diverging:  post-action delta_value is higher than breach delta_value
 * unknown:    no post-action delta has been computed yet
 */
export type ConvergenceEffectiveness =
  | 'converging'
  | 'stable'
  | 'diverging'
  | 'unknown';

/**
 * A user-logged record that a corrective action was taken in response to a breach.
 *
 * INVARIANTS (enforced at API and store layer):
 *   - takenBy must be a valid user UUID. Never system-generated.
 *   - No automated process may create a ConvergenceAction.
 *   - The system may retrospectively set postActionDeltaId once a new
 *     delta is computed after actionTakenAt.
 */
export interface ConvergenceAction {
  readonly id: string;
  readonly tenantId: string;
  readonly breachId: string;
  readonly description: string;
  readonly actionTakenAt: string;          // ISO 8601 — when externally performed
  readonly takenBy: string;                // User UUID — required, never null
  readonly postActionDeltaId: string | null;  // Linked retrospectively by the system
  readonly effectiveness: ConvergenceEffectiveness;
  readonly createdAt: string;              // ISO 8601 — when logged in the system
}

export interface CreateConvergenceActionRequest {
  readonly description: string;
  readonly actionTakenAt: string;
  // takenBy is populated from req.tenantContext.user.id — not accepted from request body
}

/**
 * expected-divergence.ts
 *
 * CAV Level 1.1 - Expected Divergence Confirmation
 *
 * Types for operator-declared planned change windows.
 * Allows confirmation of intentional divergence and detection of missed changes.
 *
 * v1.1 feature - RPD v1.1 (With Addendum)
 */

import type { DivergenceDimension } from './divergence';

/**
 * Status lifecycle of an Expected Divergence declaration.
 */
export type ExpectedDivergenceStatus =
  | 'pending'     // Window has not started or is active, no match yet
  | 'confirmed'   // Matching divergence occurred within window
  | 'missed'      // Window expired without matching divergence
  | 'cancelled';  // Operator cancelled before window_start

/**
 * An operator-declared expectation of divergence within a time window.
 */
export interface ExpectedDivergence {
  readonly id: string;
  readonly tenantId: string;
  
  // Scope
  readonly topic: string;                           // Source identifier (MQTT topic, etc.)
  readonly identityScope: string | null;            // null = applies to all devices on topic
  
  // Expected dimensions
  readonly expectedDimensions: DivergenceDimension[];  // Which dimensions expected to diverge
  
  // Time window
  readonly windowStart: string;                     // ISO 8601
  readonly windowEnd: string;                       // ISO 8601
  readonly graceMinutes: number;                    // Grace period (default: 5)
  
  // Status
  readonly status: ExpectedDivergenceStatus;
  
  // Matched events (divergence_event IDs that confirmed this expectation)
  readonly matchedEventIds: string[];
  
  // Audit
  readonly createdBy: string;                       // User ID
  readonly createdAt: string;                       // ISO 8601
  readonly resolvedAt?: string;                     // When confirmed/missed
}

/**
 * Lightweight summary for list views.
 */
export interface ExpectedDivergenceSummary {
  readonly id: string;
  readonly topic: string;
  readonly identityScope: string | null;
  readonly expectedDimensions: DivergenceDimension[];
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly status: ExpectedDivergenceStatus;
  readonly matchedCount: number;  // Number of matched events
}

/**
 * Request to create a new Expected Divergence.
 */
export interface CreateExpectedDivergenceRequest {
  readonly topic: string;
  readonly identityScope?: string | null;           // Optional: defaults to null (all devices)
  readonly expectedDimensions: DivergenceDimension[];
  readonly windowStart: string;                     // ISO 8601
  readonly windowEnd: string;                       // ISO 8601
  readonly graceMinutes?: number;                   // Optional: defaults to 5
}

/**
 * Expected Divergence Matcher result.
 * Returned when evaluating if a divergence event matches an expected divergence.
 */
export interface ExpectedDivergenceMatch {
  readonly expectedDivergenceId: string;
  readonly matched: boolean;
  readonly matchedDimension?: DivergenceDimension;  // Which dimension matched
  readonly reason?: string;                         // Why it didn't match (if matched = false)
}

/**
 * Annotated divergence event status.
 * Used in UI to label divergence events based on expectation matching.
 */
export type DivergenceEventLabel =
  | 'confirmed_planned_change'    // Matched an expected divergence
  | 'missed_planned_change'       // Expected divergence expired without match
  | 'unplanned_divergence';       // Normal divergence (no matching expectation)

/**
 * Extended divergence event with expectation annotation.
 * Used in UI timeline views.
 */
export interface AnnotatedDivergenceEvent {
  readonly eventId: string;
  readonly dimension: DivergenceDimension;
  readonly onsetAt: string;
  readonly confirmedAt?: string;
  readonly resolvedAt?: string;
  
  // Annotation
  readonly label: DivergenceEventLabel;
  readonly expectedDivergenceId?: string;           // If confirmed planned change
}

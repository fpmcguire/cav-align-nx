/**
 * matcher.ts
 *
 * CAV Level 1.1 — Expected Divergence Matcher.
 *
 * PURE COMPUTATION ONLY — matching logic only, no direct Supabase access.
 * Persistence is handled by the orchestrator via ExpectedDivergenceStore.
 *
 * CAV Level 1 hardening — Section 2 of Hardening Directive.
 */

import type { DivergenceDimension, DivergenceEventLabel } from '@cav-align/core';
import type { PendingExpectationRow } from '../../stores/expected-divergence.store';

export interface MatchableEvent {
  id: string;
  tenantId: string;
  topicId: string;
  dimension: DivergenceDimension;
  onsetEstimatedAt: string;
  deviceId?: string | null;
}

export interface MatchResult {
  label: DivergenceEventLabel;
  matchedExpectationId?: string;
  matchedExpectationMatchedIds?: string[];
}

export class ExpectedDivergenceMatcher {
  /**
   * Pure match — takes pre-fetched pending rows, returns label and which row matched.
   * No DB calls. First-match-wins.
   */
  match(event: MatchableEvent, pendingRows: PendingExpectationRow[]): MatchResult {
    for (const row of pendingRows) {
      if (this.isMatch(row, event)) {
        return {
          label:                        'confirmed_planned_change',
          matchedExpectationId:         row.id,
          matchedExpectationMatchedIds: row.matched_event_ids ?? [],
        };
      }
    }
    return { label: 'unplanned_divergence' };
  }

  private isMatch(row: PendingExpectationRow, event: MatchableEvent): boolean {
    if (row.topic !== event.topicId) return false;
    if (row.identity_scope !== null && row.identity_scope !== event.deviceId) return false;
    if (!row.expected_dimensions.includes(event.dimension)) return false;

    const graceMs       = row.grace_minutes * 60_000;
    const effectiveStart = new Date(row.window_start).getTime() - graceMs;
    const effectiveEnd   = new Date(row.window_end).getTime() + graceMs;
    const onsetMs        = new Date(event.onsetEstimatedAt).getTime();

    return onsetMs >= effectiveStart && onsetMs <= effectiveEnd;
  }
}

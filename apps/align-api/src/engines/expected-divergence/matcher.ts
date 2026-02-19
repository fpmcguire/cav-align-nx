/**
 * matcher.ts
 *
 * CAV Level 1.1 — Expected Divergence Matcher.
 *
 * Evaluates a confirmed DivergenceEvent against all pending
 * ExpectedDivergence windows for the same tenant.
 *
 * Post-processing annotation layer — does not alter divergence detection logic.
 * First-match-wins to prevent double-matching.
 */

import type { DivergenceDimension, DivergenceEventLabel } from '@cav-align/core';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface MatchableEvent {
  id: string;
  tenantId: string;
  topicId: string;       // source identifier (MQTT topic path, etc.)
  dimension: DivergenceDimension;
  onsetEstimatedAt: string;
  deviceId?: string | null;
}

export interface MatchResult {
  label: DivergenceEventLabel;
  matchedExpectedId?: string;
}

// Row shape from Supabase expected_divergences table
interface ExpectedDivergenceRow {
  id: string;
  topic: string;
  identity_scope: string | null;
  expected_dimensions: string[];
  window_start: string;
  window_end: string;
  grace_minutes: number;
  matched_event_ids: string[];
}

export class ExpectedDivergenceMatcher {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Finds a matching expected divergence for a confirmed event.
   * Returns the label to attach to the event.
   */
  async matchEvent(event: MatchableEvent): Promise<MatchResult> {
    let rows: ExpectedDivergenceRow[] = [];

    try {
      const { data, error } = await this.supabase
        .from('expected_divergences')
        .select('id, topic, identity_scope, expected_dimensions, window_start, window_end, grace_minutes, matched_event_ids')
        .eq('tenant_id', event.tenantId)
        .eq('status', 'pending');

      if (error) {
        console.error('[Matcher] query error:', error.message);
        return { label: 'unplanned_divergence' };
      }
      rows = (data ?? []) as ExpectedDivergenceRow[];
    } catch (err) {
      console.error('[Matcher] matchEvent:', err);
      return { label: 'unplanned_divergence' };
    }

    // First-match-wins
    for (const row of rows) {
      if (this.isMatch(row, event)) {
        await this.confirmExpectation(row, event);
        return { label: 'confirmed_planned_change', matchedExpectedId: row.id };
      }
    }

    return { label: 'unplanned_divergence' };
  }

  private isMatch(row: ExpectedDivergenceRow, event: MatchableEvent): boolean {
    // 1. Topic match
    if (row.topic !== event.topicId) return false;

    // 2. Identity scope match (null = all devices)
    if (row.identity_scope !== null && row.identity_scope !== event.deviceId) return false;

    // 3. Dimension match
    if (!row.expected_dimensions.includes(event.dimension)) return false;

    // 4. Time window match (with grace)
    const graceMs = row.grace_minutes * 60_000;
    const effectiveStart = new Date(row.window_start).getTime() - graceMs;
    const effectiveEnd   = new Date(row.window_end).getTime() + graceMs;
    const onsetMs = new Date(event.onsetEstimatedAt).getTime();

    if (onsetMs < effectiveStart || onsetMs > effectiveEnd) return false;

    return true;
  }

  private async confirmExpectation(row: ExpectedDivergenceRow, event: MatchableEvent): Promise<void> {
    try {
      await this.supabase
        .from('expected_divergences')
        .update({
          status: 'confirmed',
          matched_event_ids: [...(row.matched_event_ids ?? []), event.id],
          resolved_at: new Date().toISOString(),
        })
        .eq('id', row.id);
    } catch (err) {
      console.error('[Matcher] confirmExpectation:', err);
    }
  }

  /**
   * Marks pending expectations whose windows (+ grace) have expired as 'missed'.
   * Called periodically (every minute).
   */
  async checkExpiredWindows(): Promise<void> {
    try {
      // Fetch all pending expectations
      const { data, error } = await this.supabase
        .from('expected_divergences')
        .select('id, window_end, grace_minutes')
        .eq('status', 'pending');

      if (error || !data) return;

      const now = new Date();
      const expiredIds: string[] = [];

      for (const row of data as { id: string; window_end: string; grace_minutes: number }[]) {
        const effectiveEnd = new Date(row.window_end).getTime() + row.grace_minutes * 60_000;
        if (now.getTime() > effectiveEnd) {
          expiredIds.push(row.id);
        }
      }

      if (expiredIds.length === 0) return;

      await this.supabase
        .from('expected_divergences')
        .update({ status: 'missed', resolved_at: now.toISOString() })
        .in('id', expiredIds);

      console.log(`[Matcher] Marked ${expiredIds.length} expectation(s) as missed.`);
    } catch (err) {
      console.error('[Matcher] checkExpiredWindows:', err);
    }
  }
}

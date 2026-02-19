/**
 * expected-divergence.store.ts
 *
 * CAV Level 1 hardening — Store layer, Section 2 of Hardening Directive.
 *
 * Sole DB layer for the expected_divergences table.
 * All operations — create, list, get, cancel, engine-side matching — live here.
 *
 * Rules:
 *   - Service-role client throughout.
 *   - tenantId required explicitly on every method.
 *   - Explicit .eq('tenant_id', tenantId) on every query — no RLS reliance.
 *   - No business logic, no token parsing.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { rootLogger } from '../lib/logger';

// ── Types ──────────────────────────────────────────────────────────────────

export interface PendingExpectationRow {
  id:                  string;
  topic:               string;
  identity_scope:      string | null;
  expected_dimensions: string[];
  window_start:        string;
  window_end:          string;
  grace_minutes:       number;
  matched_event_ids:   string[];
}

export interface ExpectationDto {
  id:                 string;
  tenantId:           string;
  topic:              string;
  identityScope:      string | null;
  expectedDimensions: string[];
  windowStart:        string;
  windowEnd:          string;
  graceMinutes:       number;
  status:             string;
  matchedEventIds:    string[];
  createdBy:          string;
  createdAt:          string;
  resolvedAt:         string | null;
}

export interface ExpectationSummaryDto {
  id:                 string;
  topic:              string;
  identityScope:      string | null;
  expectedDimensions: string[];
  windowStart:        string;
  windowEnd:          string;
  status:             string;
  matchedCount:       number;
}

export interface CreateExpectationInput {
  tenantId:           string;
  topic:              string;
  identityScope:      string | null;
  expectedDimensions: string[];
  windowStart:        string;
  windowEnd:          string;
  graceMinutes:       number;
  createdBy:          string;
}

export interface ListExpectationFilters {
  status?: string;
  topic?:  string;
}

// ── Store ──────────────────────────────────────────────────────────────────

export class ExpectedDivergenceStore {
  private readonly log = rootLogger.child({ context: 'ExpectedDivergenceStore' });

  constructor(private readonly supabase: SupabaseClient) {}

  // ── Route-facing CRUD ────────────────────────────────────────────────────

  async create(input: CreateExpectationInput): Promise<ExpectationDto | undefined> {
    try {
      const { data, error } = await this.supabase
        .from('expected_divergences')
        .insert({
          tenant_id:           input.tenantId,
          topic:               input.topic,
          identity_scope:      input.identityScope,
          expected_dimensions: input.expectedDimensions,
          window_start:        input.windowStart,
          window_end:          input.windowEnd,
          grace_minutes:       input.graceMinutes,
          status:              'pending',
          created_by:          input.createdBy,
        })
        .select()
        .single();

      if (error) {
        this.log.error('create failed', error, { tenantId: input.tenantId });
        return undefined;
      }

      this.log.info('Expectation created', { tenantId: input.tenantId, id: data?.id });
      return rowToDto(data);
    } catch (err) {
      this.log.error('create exception', err);
      return undefined;
    }
  }

  async list(tenantId: string, filters: ListExpectationFilters = {}): Promise<ExpectationSummaryDto[]> {
    try {
      let query = this.supabase
        .from('expected_divergences')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });

      if (filters.status) query = query.eq('status', filters.status);
      if (filters.topic)  query = query.ilike('topic', `%${filters.topic}%`);

      const { data, error } = await query;

      if (error) {
        this.log.error('list failed', error, { tenantId });
        throw new Error('Failed to list expectations');
      }

      return (data ?? []).map(rowToSummaryDto);
    } catch (err) {
      this.log.error('list exception', err, { tenantId });
      throw err;
    }
  }

  async getById(tenantId: string, id: string): Promise<ExpectationDto | undefined> {
    try {
      const { data, error } = await this.supabase
        .from('expected_divergences')
        .select('*')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .single();

      if (error || !data) return undefined;
      return rowToDto(data);
    } catch (err) {
      this.log.error('getById exception', err, { tenantId });
      return undefined;
    }
  }

  async cancel(tenantId: string, id: string): Promise<ExpectationDto | null | 'not-found' | 'wrong-status' | 'window-started'> {
    try {
      // Fetch first to validate state
      const { data: existing, error: fetchError } = await this.supabase
        .from('expected_divergences')
        .select('id, status, window_start')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .single();

      if (fetchError || !existing) return 'not-found';
      if (existing.status !== 'pending') return 'wrong-status';
      if (new Date(existing.window_start as string).getTime() < Date.now()) return 'window-started';

      const { data, error } = await this.supabase
        .from('expected_divergences')
        .update({ status: 'cancelled', resolved_at: new Date().toISOString() })
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .select()
        .single();

      if (error || !data) {
        this.log.error('cancel update failed', error, { tenantId });
        return null;
      }

      this.log.info('Expectation cancelled', { tenantId, id });
      return rowToDto(data);
    } catch (err) {
      this.log.error('cancel exception', err, { tenantId });
      return null;
    }
  }

  // ── Engine-side matcher operations ───────────────────────────────────────

  async fetchPending(tenantId: string): Promise<PendingExpectationRow[]> {
    try {
      const { data, error } = await this.supabase
        .from('expected_divergences')
        .select('id, topic, identity_scope, expected_dimensions, window_start, window_end, grace_minutes, matched_event_ids')
        .eq('tenant_id', tenantId)
        .eq('status', 'pending');

      if (error) {
        this.log.error('fetchPending failed', error, { tenantId });
        return [];
      }
      return (data ?? []) as PendingExpectationRow[];
    } catch (err) {
      this.log.error('fetchPending exception', err, { tenantId });
      return [];
    }
  }

  async confirmExpectation(input: {
    tenantId:           string;
    id:                 string;
    eventId:            string;
    existingMatchedIds: string[];
  }): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('expected_divergences')
        .update({
          status:            'confirmed',
          matched_event_ids: [...input.existingMatchedIds, input.eventId],
          resolved_at:       new Date().toISOString(),
        })
        .eq('id', input.id)
        .eq('tenant_id', input.tenantId);

      if (error) {
        this.log.error('confirmExpectation failed', error, { tenantId: input.tenantId });
        return;
      }

      this.log.info('Expectation confirmed', {
        tenantId:      input.tenantId,
        expectationId: input.id,
        eventId:       input.eventId,
      });
    } catch (err) {
      this.log.error('confirmExpectation exception', err);
    }
  }

  async markExpiredAsMissed(tenantId: string): Promise<void> {
    try {
      const { data, error } = await this.supabase
        .from('expected_divergences')
        .select('id, window_end, grace_minutes')
        .eq('tenant_id', tenantId)
        .eq('status', 'pending');

      if (error || !data) return;

      const now        = Date.now();
      const expiredIds = (data as { id: string; window_end: string; grace_minutes: number }[])
        .filter((r) => now > new Date(r.window_end).getTime() + r.grace_minutes * 60_000)
        .map((r) => r.id);

      if (expiredIds.length === 0) return;

      const { error: updateError } = await this.supabase
        .from('expected_divergences')
        .update({ status: 'missed', resolved_at: new Date().toISOString() })
        .in('id', expiredIds)
        .eq('tenant_id', tenantId);

      if (updateError) {
        this.log.error('markExpiredAsMissed update failed', updateError, { tenantId });
        return;
      }

      this.log.info('Marked expectations as missed', { tenantId, count: expiredIds.length });
    } catch (err) {
      this.log.error('markExpiredAsMissed exception', err);
    }
  }
}

// ── Row mappers ────────────────────────────────────────────────────────────

function rowToDto(row: Record<string, unknown>): ExpectationDto {
  return {
    id:                 row['id'] as string,
    tenantId:           row['tenant_id'] as string,
    topic:              row['topic'] as string,
    identityScope:      (row['identity_scope'] as string) ?? null,
    expectedDimensions: (row['expected_dimensions'] as string[]) ?? [],
    windowStart:        row['window_start'] as string,
    windowEnd:          row['window_end'] as string,
    graceMinutes:       row['grace_minutes'] as number,
    status:             row['status'] as string,
    matchedEventIds:    (row['matched_event_ids'] as string[]) ?? [],
    createdBy:          row['created_by'] as string,
    createdAt:          row['created_at'] as string,
    resolvedAt:         (row['resolved_at'] as string) ?? null,
  };
}

function rowToSummaryDto(row: Record<string, unknown>): ExpectationSummaryDto {
  return {
    id:                 row['id'] as string,
    topic:              row['topic'] as string,
    identityScope:      (row['identity_scope'] as string) ?? null,
    expectedDimensions: (row['expected_dimensions'] as string[]) ?? [],
    windowStart:        row['window_start'] as string,
    windowEnd:          row['window_end'] as string,
    status:             row['status'] as string,
    matchedCount:       ((row['matched_event_ids'] as string[]) ?? []).length,
  };
}

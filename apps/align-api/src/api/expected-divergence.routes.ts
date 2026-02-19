/**
 * expected-divergence.routes.ts
 *
 * REST API endpoints for the Expected Divergence system (v1.1).
 *
 * All endpoints require a valid Supabase JWT (user-scoped — RLS enforced).
 * Tenant ID is derived from the JWT via the tenant_users RLS policy.
 *
 * Routes:
 *   POST   /api/expected-divergences          Create expectation
 *   GET    /api/expected-divergences          List (with filters)
 *   GET    /api/expected-divergences/:id      Get single
 *   PATCH  /api/expected-divergences/:id/cancel  Cancel (before window_start)
 */

import type { Router } from 'express';
import { Router as createRouter } from 'express';
import { createClient } from '@supabase/supabase-js';

export function createExpectedDivergenceRouter(): Router {
  const router = createRouter();

  // ---------------------------------------------------------------------------
  // Helper: derive user-scoped Supabase client from bearer token
  // ---------------------------------------------------------------------------
  function getUserClient(authHeader: string | undefined) {
    const url = process.env['SUPABASE_URL'];
    const anonKey = process.env['SUPABASE_ANON_KEY'];
    if (!url || !anonKey) return null;

    const token = authHeader?.replace('Bearer ', '');
    if (!token) return null;

    return createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
  }

  // ---------------------------------------------------------------------------
  // POST /api/expected-divergences
  // ---------------------------------------------------------------------------
  router.post('/', async (req, res) => {
    const supabase = getUserClient(req.headers.authorization);
    if (!supabase) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { topic, identityScope, expectedDimensions, windowStart, windowEnd, graceMinutes } = req.body;

    // Validation
    if (!topic) return res.status(400).json({ error: 'topic is required' });
    if (!Array.isArray(expectedDimensions) || expectedDimensions.length === 0) {
      return res.status(400).json({ error: 'expectedDimensions must be a non-empty array' });
    }

    const validDimensions = ['shape', 'cadence', 'domain'];
    for (const d of expectedDimensions) {
      if (!validDimensions.includes(d)) {
        return res.status(400).json({ error: `Invalid dimension: ${d}` });
      }
    }

    if (!windowStart || !windowEnd) {
      return res.status(400).json({ error: 'windowStart and windowEnd are required' });
    }

    const startMs = new Date(windowStart).getTime();
    const endMs   = new Date(windowEnd).getTime();

    if (isNaN(startMs) || isNaN(endMs)) {
      return res.status(400).json({ error: 'windowStart and windowEnd must be valid ISO 8601 dates' });
    }

    if (endMs <= startMs) {
      return res.status(400).json({ error: 'windowEnd must be after windowStart' });
    }

    if (startMs < Date.now() - 60_000) {
      return res.status(400).json({ error: 'windowStart cannot be in the past' });
    }

    const grace = typeof graceMinutes === 'number' ? graceMinutes : 5;
    if (grace < 0) return res.status(400).json({ error: 'graceMinutes must be >= 0' });

    // Get user ID
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return res.status(401).json({ error: 'Unauthorized' });

    // Get tenant ID
    const { data: tenantUser } = await supabase
      .from('tenant_users')
      .select('tenant_id')
      .eq('user_id', user.id)
      .single();

    if (!tenantUser) {
      return res.status(403).json({ error: 'No tenant associated with this user' });
    }

    const { data, error } = await supabase
      .from('expected_divergences')
      .insert({
        tenant_id: tenantUser.tenant_id,
        topic,
        identity_scope: identityScope ?? null,
        expected_dimensions: expectedDimensions,
        window_start: windowStart,
        window_end: windowEnd,
        grace_minutes: grace,
        status: 'pending',
        created_by: user.id,
      })
      .select()
      .single();

    if (error) {
      console.error('[Expected Div API] insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create expectation' });
    }

    return res.status(201).json(rowToDto(data));
  });

  // ---------------------------------------------------------------------------
  // GET /api/expected-divergences
  // ---------------------------------------------------------------------------
  router.get('/', async (req, res) => {
    const supabase = getUserClient(req.headers.authorization);
    if (!supabase) return res.status(401).json({ error: 'Unauthorized' });

    let query = supabase
      .from('expected_divergences')
      .select('*')
      .order('created_at', { ascending: false });

    // Filters
    if (req.query['status']) {
      query = query.eq('status', req.query['status'] as string);
    }
    if (req.query['topic']) {
      query = query.ilike('topic', `%${req.query['topic']}%`);
    }

    const { data, error } = await query;

    if (error) {
      return res.status(500).json({ error: 'Failed to list expectations' });
    }

    return res.json((data ?? []).map(rowToSummaryDto));
  });

  // ---------------------------------------------------------------------------
  // GET /api/expected-divergences/:id
  // ---------------------------------------------------------------------------
  router.get('/:id', async (req, res) => {
    const supabase = getUserClient(req.headers.authorization);
    if (!supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data, error } = await supabase
      .from('expected_divergences')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Not found' });
    }

    return res.json(rowToDto(data));
  });

  // ---------------------------------------------------------------------------
  // PATCH /api/expected-divergences/:id/cancel
  // ---------------------------------------------------------------------------
  router.patch('/:id/cancel', async (req, res) => {
    const supabase = getUserClient(req.headers.authorization);
    if (!supabase) return res.status(401).json({ error: 'Unauthorized' });

    // Fetch current record
    const { data: existing, error: fetchError } = await supabase
      .from('expected_divergences')
      .select('id, status, window_start')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !existing) {
      return res.status(404).json({ error: 'Not found' });
    }

    if (existing.status !== 'pending') {
      return res.status(409).json({ error: `Cannot cancel expectation with status '${existing.status}'` });
    }

    if (new Date(existing.window_start).getTime() < Date.now()) {
      return res.status(409).json({ error: 'Cannot cancel expectation after window_start has passed' });
    }

    const { data, error } = await supabase
      .from('expected_divergences')
      .update({ status: 'cancelled', resolved_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: 'Failed to cancel expectation' });
    }

    return res.json(rowToDto(data));
  });

  return router;
}

// ---------------------------------------------------------------------------
// DTO mappers (snake_case DB → camelCase API)
// ---------------------------------------------------------------------------

function rowToDto(row: Record<string, unknown>) {
  return {
    id:                 row['id'],
    tenantId:           row['tenant_id'],
    topic:              row['topic'],
    identityScope:      row['identity_scope'],
    expectedDimensions: row['expected_dimensions'],
    windowStart:        row['window_start'],
    windowEnd:          row['window_end'],
    graceMinutes:       row['grace_minutes'],
    status:             row['status'],
    matchedEventIds:    row['matched_event_ids'],
    createdBy:          row['created_by'],
    createdAt:          row['created_at'],
    resolvedAt:         row['resolved_at'],
  };
}

function rowToSummaryDto(row: Record<string, unknown>) {
  return {
    id:                 row['id'],
    topic:              row['topic'],
    identityScope:      row['identity_scope'],
    expectedDimensions: row['expected_dimensions'],
    windowStart:        row['window_start'],
    windowEnd:          row['window_end'],
    status:             row['status'],
    matchedCount:       (row['matched_event_ids'] as string[] | null)?.length ?? 0,
  };
}

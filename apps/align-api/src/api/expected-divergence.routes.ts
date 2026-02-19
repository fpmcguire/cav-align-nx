/**
 * expected-divergence.routes.ts
 *
 * Thin controllers for Expected Divergence endpoints.
 * tenantContext already attached to req by tenantAuthMiddleware in routes.ts.
 * No tenant derivation logic here.
 *
 * CAV Level 1 hardening — Section 2 (Routes) of Hardening Directive.
 */

import type { Router } from 'express';
import { Router as createRouter } from 'express';
import { createClient } from '@supabase/supabase-js';

export function createExpectedDivergenceRouter(): Router {
  const router = createRouter();

  function getUserClient(authHeader: string | undefined) {
    const url  = process.env['SUPABASE_URL'];
    const anon = process.env['SUPABASE_ANON_KEY'];
    if (!url || !anon) return null;
    const token = authHeader?.replace('Bearer ', '');
    if (!token) return null;
    return createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  // POST /
  router.post('/', async (req, res) => {
    const tenantId = req.tenantContext?.tenant?.id;
    if (!tenantId) return res.status(401).json({ error: 'Unauthorized' });

    const supabase = getUserClient(req.headers.authorization);
    if (!supabase) return res.status(501).json({ error: 'Supabase not configured' });

    const { topic, identityScope, expectedDimensions, windowStart, windowEnd, graceMinutes } = req.body;

    if (!topic) return res.status(400).json({ error: 'topic is required' });
    if (!Array.isArray(expectedDimensions) || expectedDimensions.length === 0) {
      return res.status(400).json({ error: 'expectedDimensions must be a non-empty array' });
    }
    for (const d of expectedDimensions) {
      if (!['shape', 'cadence', 'domain'].includes(d)) {
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

    const { data, error } = await supabase
      .from('expected_divergences')
      .insert({
        tenant_id:           tenantId,
        topic,
        identity_scope:      identityScope ?? null,
        expected_dimensions: expectedDimensions,
        window_start:        windowStart,
        window_end:          windowEnd,
        grace_minutes:       grace,
        status:              'pending',
        created_by:          req.tenantContext.user.id,
      })
      .select()
      .single();

    if (error) {
      req.log.error('Expected divergence insert failed', error, { tenantId });
      return res.status(500).json({ error: 'Failed to create expectation' });
    }

    return res.status(201).json(rowToDto(data));
  });

  // GET /
  router.get('/', async (req, res) => {
    const supabase = getUserClient(req.headers.authorization);
    if (!supabase) return res.status(501).json({ error: 'Supabase not configured' });

    let query = supabase
      .from('expected_divergences')
      .select('*')
      .order('created_at', { ascending: false });

    if (req.query['status']) query = query.eq('status', req.query['status'] as string);
    if (req.query['topic'])  query = query.ilike('topic', `%${req.query['topic']}%`);

    const { data, error } = await query;
    if (error) {
      req.log.error('Expected divergence list failed', error);
      return res.status(500).json({ error: 'Failed to list expectations' });
    }

    return res.json((data ?? []).map(rowToSummaryDto));
  });

  // GET /:id
  router.get('/:id', async (req, res) => {
    const supabase = getUserClient(req.headers.authorization);
    if (!supabase) return res.status(501).json({ error: 'Supabase not configured' });

    const { data, error } = await supabase
      .from('expected_divergences')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Not found' });
    return res.json(rowToDto(data));
  });

  // PATCH /:id/cancel
  router.patch('/:id/cancel', async (req, res) => {
    const supabase = getUserClient(req.headers.authorization);
    if (!supabase) return res.status(501).json({ error: 'Supabase not configured' });

    const { data: existing, error: fetchError } = await supabase
      .from('expected_divergences')
      .select('id, status, window_start')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !existing) return res.status(404).json({ error: 'Not found' });

    if (existing.status !== 'pending') {
      return res.status(409).json({ error: `Cannot cancel expectation with status '${existing.status}'` });
    }
    if (new Date(existing.window_start).getTime() < Date.now()) {
      return res.status(409).json({ error: 'Cannot cancel after window_start has passed' });
    }

    const { data, error } = await supabase
      .from('expected_divergences')
      .update({ status: 'cancelled', resolved_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) {
      req.log.error('Cancel expectation failed', error);
      return res.status(500).json({ error: 'Failed to cancel expectation' });
    }

    return res.json(rowToDto(data));
  });

  return router;
}

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

/**
 * expected-divergence.routes.ts
 *
 * Thin controllers for Expected Divergence endpoints.
 * CAV Level 1 — final hardening: no token re-parsing, no direct Supabase calls.
 *
 * All DB access via ExpectedDivergenceStore (service-role, tenantId explicit).
 * tenantId always from req.tenantContext.tenant.id.
 * Validation logic lives here; persistence logic lives in the store.
 */

import { Router } from 'express';
import type { ExpectedDivergenceStore } from '../stores/expected-divergence.store';

export function createExpectedDivergenceRouter(store: ExpectedDivergenceStore): Router {
  const router = Router();

  // POST / — create expectation
  router.post('/', async (req, res) => {
    const tenantId = req.tenantContext.tenant.id;
    const { topic, identityScope, expectedDimensions, windowStart, windowEnd, graceMinutes } = req.body;

    // ── Validation ────────────────────────────────────────────────────────
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

    // ── Persist via store ─────────────────────────────────────────────────
    const result = await store.create({
      tenantId,
      topic,
      identityScope:      identityScope ?? null,
      expectedDimensions,
      windowStart,
      windowEnd,
      graceMinutes:       grace,
      createdBy:          req.tenantContext.user.id,
    });

    if (!result) {
      req.log.error('Expected divergence create failed', undefined, { tenantId });
      return res.status(500).json({ error: 'Failed to create expectation' });
    }

    return res.status(201).json(result);
  });

  // GET / — list expectations
  router.get('/', async (req, res) => {
    const tenantId = req.tenantContext.tenant.id;

    try {
      const expectations = await store.list(tenantId, {
        status: req.query['status'] as string | undefined,
        topic:  req.query['topic']  as string | undefined,
      });
      return res.json(expectations);
    } catch {
      req.log.error('Expected divergence list failed', undefined, { tenantId });
      return res.status(500).json({ error: 'Failed to list expectations' });
    }
  });

  // GET /:id — get single expectation
  router.get('/:id', async (req, res) => {
    const tenantId = req.tenantContext.tenant.id;
    const result   = await store.getById(tenantId, req.params['id']);

    if (!result) return res.status(404).json({ error: 'Not found' });
    return res.json(result);
  });

  // PATCH /:id/cancel — cancel pending expectation
  router.patch('/:id/cancel', async (req, res) => {
    const tenantId = req.tenantContext.tenant.id;
    const result   = await store.cancel(tenantId, req.params['id']);

    if (result === 'not-found')     return res.status(404).json({ error: 'Not found' });
    if (result === 'wrong-status')  return res.status(409).json({ error: 'Expectation is not pending' });
    if (result === 'window-started') return res.status(409).json({ error: 'Cannot cancel after window_start has passed' });
    if (result === null)            return res.status(500).json({ error: 'Failed to cancel expectation' });

    return res.json(result);
  });

  return router;
}

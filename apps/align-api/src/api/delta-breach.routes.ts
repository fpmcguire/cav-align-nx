/**
 * delta-breach.routes.ts
 *
 * CAV Level 4 — Thin controllers for:
 *   /api/deltas     — alignment delta time-series
 *   /api/breaches   — envelope breach events + convergence actions
 *
 * Contract:
 *   - tenantId always from req.tenantContext.tenant.id
 *   - All DB access via DeltaStore / BreachStore / ConvergenceActionStore
 *   - No token re-parsing, no direct Supabase calls
 */

import { Router } from 'express';
import type { DeltaStore } from '../stores/delta.store';
import type { BreachStore } from '../stores/breach.store';
import type { ConvergenceActionStore } from '../stores/convergence-action.store';

export function createDeltaRouter(deltaStore: DeltaStore): Router {
  const router = Router();

  // ── GET / — query delta time-series ────────────────────────────────────
  router.get('/', async (req, res) => {
    const tenantId = req.tenantContext.tenant.id;
    try {
      const deltas = await deltaStore.query(tenantId, {
        topicScope: req.query['topicScope'] as string | undefined,
        dimension:  req.query['dimension']  as any,
        from:       req.query['from']       as string | undefined,
        until:      req.query['until']      as string | undefined,
      });
      return res.json(deltas);
    } catch {
      return res.status(500).json({ error: 'Failed to query deltas' });
    }
  });

  // ── GET /:id — get single delta with full detail ────────────────────────
  router.get('/:id', async (req, res) => {
    const tenantId = req.tenantContext.tenant.id;
    const delta    = await deltaStore.getById(tenantId, req.params['id']);
    if (!delta) return res.status(404).json({ error: 'Not found' });
    return res.json(delta);
  });

  return router;
}

export function createBreachRouter(
  breachStore:  BreachStore,
  actionStore?: ConvergenceActionStore,
): Router {
  const router = Router();

  // ── GET / — list breach events ──────────────────────────────────────────
  router.get('/', async (req, res) => {
    const tenantId = req.tenantContext.tenant.id;
    try {
      const breaches = await breachStore.list(tenantId, {
        status:     req.query['status']     as any,
        dimension:  req.query['dimension']  as any,
        topicScope: req.query['topicScope'] as string | undefined,
      });
      return res.json(breaches);
    } catch {
      return res.status(500).json({ error: 'Failed to list breaches' });
    }
  });

  // ── GET /:id — get breach detail + evidence ─────────────────────────────
  router.get('/:id', async (req, res) => {
    const tenantId = req.tenantContext.tenant.id;
    const breach   = await breachStore.getById(tenantId, req.params['id']);
    if (!breach) return res.status(404).json({ error: 'Not found' });
    return res.json(breach);
  });

  // ── POST /:id/actions — log convergence action ──────────────────────────
  router.post('/:id/actions', async (req, res) => {
    if (!actionStore) return res.status(501).json({ error: 'Supabase not configured' });

    const tenantId = req.tenantContext.tenant.id;
    const takenBy  = req.tenantContext.user.id;  // Always from auth context — never from body
    const { description, actionTakenAt } = req.body;

    if (!description)   return res.status(400).json({ error: 'description is required' });
    if (!actionTakenAt) return res.status(400).json({ error: 'actionTakenAt is required' });

    if (isNaN(new Date(actionTakenAt).getTime())) {
      return res.status(400).json({ error: 'actionTakenAt must be a valid ISO 8601 date' });
    }

    // Verify breach exists and belongs to tenant
    const breach = await breachStore.getById(tenantId, req.params['id']);
    if (!breach) return res.status(404).json({ error: 'Breach not found' });

    const action = await actionStore.create({
      tenantId,
      breachId:      req.params['id'],
      description,
      actionTakenAt,
      takenBy,        // Populated from auth context — never from request body
    });

    if (!action) return res.status(500).json({ error: 'Failed to log convergence action' });
    return res.status(201).json(action);
  });

  // ── GET /:id/actions — list actions for breach ──────────────────────────
  router.get('/:id/actions', async (req, res) => {
    if (!actionStore) return res.status(501).json({ error: 'Supabase not configured' });

    const tenantId = req.tenantContext.tenant.id;

    // Verify breach exists and belongs to tenant
    const breach = await breachStore.getById(tenantId, req.params['id']);
    if (!breach) return res.status(404).json({ error: 'Breach not found' });

    try {
      const actions = await actionStore.listForBreach(tenantId, req.params['id']);
      return res.json(actions);
    } catch {
      return res.status(500).json({ error: 'Failed to list convergence actions' });
    }
  });

  return router;
}

/**
 * intent.routes.ts
 *
 * CAV Level 3 — Thin controllers for Intent Artifact + Version endpoints.
 *
 * Contract:
 *   - tenantId always from req.tenantContext.tenant.id
 *   - All DB access via IntentArtifactStore / IntentVersionStore
 *   - No token re-parsing, no direct Supabase calls
 *   - Validation here; persistence in stores
 */

import { Router } from 'express';
import type { IntentArtifactStore } from '../stores/intent-artifact.store';
import type { IntentVersionStore } from '../stores/intent-version.store';
import type { AlignWebSocketServer } from '../websocket/websocket-server';

export function createIntentRouter(
  artifactStore: IntentArtifactStore,
  versionStore:  IntentVersionStore,
  wsServer?:     AlignWebSocketServer,
): Router {
  const router = Router();

  // ── POST / — create artifact ────────────────────────────────────────────
  router.post('/', async (req, res) => {
    const tenantId  = req.tenantContext.tenant.id;
    const createdBy = req.tenantContext.user.id;
    const { name, topicScope, dimension, precedence } = req.body;

    if (!name)        return res.status(400).json({ error: 'name is required' });
    if (!topicScope)  return res.status(400).json({ error: 'topicScope is required' });
    if (!['shape', 'cadence', 'domain'].includes(dimension)) {
      return res.status(400).json({ error: "dimension must be 'shape', 'cadence', or 'domain'" });
    }

    const result = await artifactStore.create(tenantId, createdBy, { name, topicScope, dimension, precedence });
    if (!result) return res.status(500).json({ error: 'Failed to create intent artifact' });

    return res.status(201).json(result);
  });

  // ── GET / — list artifacts ──────────────────────────────────────────────
  router.get('/', async (req, res) => {
    const tenantId = req.tenantContext.tenant.id;
    try {
      const artifacts = await artifactStore.list(tenantId, {
        dimension:  req.query['dimension']  as string | undefined as any,
        status:     req.query['status']     as string | undefined as any,
        topicScope: req.query['topicScope'] as string | undefined,
      });
      return res.json(artifacts);
    } catch {
      return res.status(500).json({ error: 'Failed to list intent artifacts' });
    }
  });

  // ── GET /:id — get artifact ─────────────────────────────────────────────
  router.get('/:id', async (req, res) => {
    const tenantId = req.tenantContext.tenant.id;
    const artifact = await artifactStore.getById(tenantId, req.params['id']);
    if (!artifact) return res.status(404).json({ error: 'Not found' });
    return res.json(artifact);
  });

  // ── PATCH /:id/archive — archive artifact ───────────────────────────────
  router.patch('/:id/archive', async (req, res) => {
    const tenantId = req.tenantContext.tenant.id;
    const result   = await artifactStore.archive(tenantId, req.params['id']);

    if (result === 'not-found') return res.status(404).json({ error: 'Not found' });
    if (result === null)        return res.status(500).json({ error: 'Failed to archive' });
    return res.json(result);
  });

  // ── POST /:id/versions — create draft version ───────────────────────────
  router.post('/:id/versions', async (req, res) => {
    const tenantId  = req.tenantContext.tenant.id;
    const createdBy = req.tenantContext.user.id;
    const { definition, effectiveFrom } = req.body;

    if (!definition)    return res.status(400).json({ error: 'definition is required' });
    if (!effectiveFrom) return res.status(400).json({ error: 'effectiveFrom is required' });

    if (isNaN(new Date(effectiveFrom).getTime())) {
      return res.status(400).json({ error: 'effectiveFrom must be a valid ISO 8601 date' });
    }

    const result = await versionStore.create(tenantId, req.params['id'], createdBy, {
      definition,
      effectiveFrom,
    });

    if (result === 'invalid-schema') {
      return res.status(400).json({ error: 'Unsupported definition schemaVersion' });
    }
    if (!result) return res.status(500).json({ error: 'Failed to create intent version' });

    return res.status(201).json(result);
  });

  // ── PATCH /:id/versions/:vid/activate — activate version ───────────────
  router.patch('/:id/versions/:vid/activate', async (req, res) => {
    const tenantId = req.tenantContext.tenant.id;
    const result   = await versionStore.activate(tenantId, req.params['id'], req.params['vid']);

    if (result === 'not-found')             return res.status(404).json({ error: 'Version not found' });
    if (result === 'already-active')        return res.status(409).json({ error: 'Version is already active' });
    if (result === 'missing-effective-from') return res.status(409).json({ error: 'effectiveFrom is required before activation' });
    if (result === null)                    return res.status(500).json({ error: 'Failed to activate version' });

    // Broadcast intent:updated to all tenant WS subscribers
    wsServer?.broadcastToTenant(tenantId, {
      type:             'intent:updated',
      tenantId,
      artifactId:       req.params['id'],
      topicScope:       result.definition && 'requiredFields' in result.definition
        ? (result as any).topicScope ?? ''
        : '',
      dimension:        req.body['dimension'] ?? 'shape',
      newVersionNumber: result.versionNumber,
      effectiveFrom:    result.effectiveFrom,
    });

    return res.json(result);
  });

  // ── GET /:id/versions — list version history ────────────────────────────
  router.get('/:id/versions', async (req, res) => {
    const tenantId = req.tenantContext.tenant.id;
    try {
      const versions = await versionStore.listForArtifact(tenantId, req.params['id']);
      return res.json(versions);
    } catch {
      return res.status(500).json({ error: 'Failed to list versions' });
    }
  });

  // ── GET /:id/versions/:vid — get single version ─────────────────────────
  router.get('/:id/versions/:vid', async (req, res) => {
    const tenantId = req.tenantContext.tenant.id;
    const version  = await versionStore.getById(tenantId, req.params['vid']);
    if (!version) return res.status(404).json({ error: 'Not found' });
    return res.json(version);
  });

  return router;
}

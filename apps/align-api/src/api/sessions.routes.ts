/**
 * sessions.routes.ts
 *
 * Thin controllers for Sessions endpoints.
 * CAV Level 1 — runtime monitoring session queries.
 *
 * All DB access via SessionStore (service-role, tenantId explicit).
 * tenantId always from req.tenantContext.tenant.id.
 */

import { Router } from 'express';
import type { SessionStore } from '../stores/session.store';

export function createSessionsRouter(store: SessionStore): Router {
  const router = Router();

  // GET / — list sessions
  router.get('/', async (req, res) => {
    const tenantId = req.tenantContext.tenant.id;

    try {
      const sessions = await store.listSessions(tenantId);
      return res.json({ sessions });
    } catch {
      req.log.error('Sessions list failed', undefined, { tenantId });
      return res.status(500).json({ error: 'Failed to list sessions' });
    }
  });

  // GET /:id — get single session
  router.get('/:id', async (req, res) => {
    const tenantId = req.tenantContext.tenant.id;
    const session  = await store.getSession(tenantId, req.params['id']);

    if (!session) return res.status(404).json({ error: 'Session not found' });
    return res.json(session);
  });

  return router;
}

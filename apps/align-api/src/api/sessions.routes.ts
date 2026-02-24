/**
 * sessions.routes.ts
 *
 * Thin controllers for Sessions endpoints.
 * CAV Level 1 — runtime monitoring session queries.
 *
 * All DB access via SessionStore (service-role, tenantId explicit).
 * tenantId always from req.tenantContext.tenant.id.
 *
 * Transforms database snake_case to API camelCase per Contract v1.0.
 */

import { Router } from 'express';
import type { SessionStore } from '../stores/session.store';
import { transformSessionsToApi, transformSessionToApi, type DbSession } from './session.transform';

export function createSessionsRouter(store: SessionStore): Router {
  const router = Router();

  // GET / — list sessions
  router.get('/', async (req, res) => {
    const tenantId = req.tenantContext.tenant.id;

    try {
      const dbSessions = await store.listSessions(tenantId) as DbSession[];
      const apiSessions = transformSessionsToApi(dbSessions);
      
      return res.json({ sessions: apiSessions });
    } catch {
      req.log.error('Sessions list failed', undefined, { tenantId });
      return res.status(500).json({ error: 'Failed to list sessions' });
    }
  });

  // GET /:id — get single session
  router.get('/:id', async (req, res) => {
    const tenantId = req.tenantContext.tenant.id;
    const dbSession  = await store.getSession(tenantId, req.params['id']) as DbSession | null;

    if (!dbSession) return res.status(404).json({ error: 'Session not found' });
    
    const apiSession = transformSessionToApi(dbSession);
    return res.json(apiSession);
  });

  return router;
}

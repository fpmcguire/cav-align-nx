/**
 * routes.ts
 *
 * Thin route controllers — no tenant derivation, no token re-parsing.
 * All DB access via store layer only.
 * tenantId always comes from req.tenantContext.tenant.id.
 *
 * Rate limiting:
 *   - anonRateLimit applied globally in app.ts (before auth)
 *   - tenantRateLimit applied here after tenantAuthMiddleware (300/60s per tenant)
 *
 * CAV Level 1 — Session C hardening complete.
 */

import type { Express } from 'express';
import type { ModuleRegistry } from '../modules/module-registry';
import type { IngestionOrchestrator } from '../ingestion/ingestion-orchestrator';
import type { AlignWebSocketServer } from '../websocket/websocket-server';
import { tenantAuthMiddleware } from '../middleware/auth.middleware';
import { tenantRateLimit } from '../middleware/rate-limit.middleware';
import { createExpectedDivergenceRouter } from './expected-divergence.routes';
import { DivergenceStore } from '../stores/divergence.store';
import { ObservedTruthStore } from '../stores/observed-truth.store';
import { ConnectionStore } from '../stores/connection.store';
import { ExpectedDivergenceStore } from '../stores/expected-divergence.store';
import { getSupabaseClient } from '../lib/supabase-client';
import { hasModule } from '@cav-align/core';
import type { ProtocolType } from '@cav-align/core';

export interface ApiDependencies {
  moduleRegistry: ModuleRegistry;
  ingestionOrchestrator: IngestionOrchestrator;
  wsServer: AlignWebSocketServer;
}

// Auth + tenant rate limit applied together on every protected route group
const protect = [tenantAuthMiddleware, tenantRateLimit];

export function setupApiRoutes(app: Express, deps: ApiDependencies): void {
  const { moduleRegistry } = deps;

  // Service-role store instances — shared across requests (stateless)
  const supabase = getSupabaseClient();
  const divStore = supabase ? new DivergenceStore(supabase) : null;
  const otStore = supabase ? new ObservedTruthStore(supabase) : null;
  const connStore = supabase ? new ConnectionStore(supabase) : null;
  const edStore = supabase ? new ExpectedDivergenceStore(supabase) : null;

  // ── Public — no auth ─────────────────────────────────────────────────────
  app.get('/api', (_req, res) => {
    res.json({
      service: 'align-api',
      version: '2.0.0',
      registeredProtocols: moduleRegistry.getRegisteredProtocols(),
      activeConnections: moduleRegistry.getActiveConnectionIds().length,
    });
  });

  // ── Expected divergences ─────────────────────────────────────────────────
  if (edStore) {
    app.use('/api/expected-divergences', ...protect, createExpectedDivergenceRouter(edStore));
  }

  // ── Divergence events ─────────────────────────────────────────────────────
  app.get('/api/divergence', ...protect, async (req, res) => {
    if (!divStore) return res.status(501).json({ error: 'Supabase not configured' });

    try {
      const events = await divStore.listEvents(req.tenantContext.tenant.id, {
        status: req.query['status'] as string | undefined,
        dimension: req.query['dimension'] as string | undefined,
      });
      return res.json({ events });
    } catch {
      req.log.error('Failed to fetch divergence events');
      return res.status(500).json({ error: 'Failed to fetch divergence events' });
    }
  });

  // ── Sources ───────────────────────────────────────────────────────────────
  app.get('/api/sources', ...protect, async (req, res) => {
    if (!otStore) return res.status(501).json({ error: 'Supabase not configured' });

    try {
      const sources = await otStore.listSources(req.tenantContext.tenant.id);
      return res.json({ sources });
    } catch {
      req.log.error('Failed to fetch sources');
      return res.status(500).json({ error: 'Failed to fetch sources' });
    }
  });

  // ── Connections ───────────────────────────────────────────────────────────
  app.post('/api/connections', ...protect, async (req, res) => {
    if (!connStore) return res.status(501).json({ error: 'Supabase not configured' });

    const { tenantContext } = req;
    const { name, protocol, config, credentials } = req.body as {
      name: string;
      protocol: ProtocolType;
      config: Record<string, unknown>;
      credentials: Record<string, unknown>;
    };

    if (!name || !protocol || !config || !credentials) {
      return res.status(400).json({ error: 'name, protocol, config and credentials are required' });
    }

    const validProtocols: ProtocolType[] = ['mqtt', 'http', 'kafka'];
    if (!validProtocols.includes(protocol)) {
      return res.status(400).json({ error: `Invalid protocol: ${protocol}` });
    }

    if (!hasModule(tenantContext, protocol)) {
      req.log.warn('Entitlement denied', { tenantId: tenantContext.tenant.id, protocol });
      return res.status(403).json({
        error: `Your subscription does not include the ${protocol.toUpperCase()} module`,
      });
    }

    try {
      const connection = await connStore.create({
        tenantId: tenantContext.tenant.id,
        name,
        protocol,
        config,
        credentials,
        createdBy: tenantContext.user.id,
      });

      if (!connection) return res.status(500).json({ error: 'Failed to create connection' });

      req.log.info('Connection created', {
        tenantId: tenantContext.tenant.id,
        connectionId: connection.id,
        protocol,
      });

      return res.status(201).json(connection);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create connection';
      req.log.error('Connection create failed', err);
      return res.status(500).json({ error: message });
    }
  });

  app.get('/api/connections', ...protect, async (req, res) => {
    if (!connStore) return res.status(501).json({ error: 'Supabase not configured' });
    const connections = await connStore.list(req.tenantContext.tenant.id);
    return res.json({ connections });
  });

  app.delete('/api/connections/:id', ...protect, async (req, res) => {
    if (!connStore) return res.status(501).json({ error: 'Supabase not configured' });

    const deleted = await connStore.delete(req.tenantContext.tenant.id, req.params['id']);
    if (!deleted) return res.status(404).json({ error: 'Connection not found' });

    req.log.info('Connection deleted', {
      tenantId: req.tenantContext.tenant.id,
      connectionId: req.params['id'],
    });

    return res.status(204).send();
  });

  // ── Sessions (stub) ───────────────────────────────────────────────────────
  app.post('/api/sessions', (_, res) => res.status(501).json({ error: 'Not implemented' }));
  app.get('/api/sessions', (_, res) => res.status(501).json({ error: 'Not implemented' }));

  console.log('[API] Routes registered (v1.1.0 — Session C hardened)');
}

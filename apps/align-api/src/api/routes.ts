/**
 * routes.ts
 *
 * Thin route controllers — no tenant derivation, no direct Supabase access.
 * All routes protected by tenantAuthMiddleware.
 * tenantId always comes from req.tenantContext.
 * All DB access via store layer only.
 *
 * CAV Level 1 hardening — Session A complete.
 */

import type { Express } from 'express';
import type { ModuleRegistry } from '../modules/module-registry';
import type { IngestionOrchestrator } from '../ingestion/ingestion-orchestrator';
import type { AlignWebSocketServer } from '../websocket/websocket-server';
import { tenantAuthMiddleware } from '../middleware/auth.middleware';
import { createExpectedDivergenceRouter } from './expected-divergence.routes';
import { listDivergenceEvents } from '../stores/divergence.store';
import { listSources } from '../stores/observed-truth.store';
import { ConnectionStore } from '../stores/connection.store';
import { getSupabaseClient } from '../lib/supabase-client';
import { hasModule } from '@cav-align/core';
import type { ProtocolType } from '@cav-align/core';

export interface ApiDependencies {
  moduleRegistry:        ModuleRegistry;
  ingestionOrchestrator: IngestionOrchestrator;
  wsServer:              AlignWebSocketServer;
}

export function setupApiRoutes(app: Express, deps: ApiDependencies): void {
  const { moduleRegistry, ingestionOrchestrator } = deps;

  // ── Public — no auth ─────────────────────────────────────────────────────
  app.get('/api', (_req, res) => {
    res.json({
      service:             'align-api',
      version:             '1.1.0',
      registeredProtocols: moduleRegistry.getRegisteredProtocols(),
      activeConnections:   moduleRegistry.getActiveConnectionIds().length,
    });
  });

  // ── Expected divergences ─────────────────────────────────────────────────
  app.use('/api/expected-divergences', tenantAuthMiddleware, createExpectedDivergenceRouter());

  // ── Divergence events ─────────────────────────────────────────────────────
  app.get('/api/divergence', tenantAuthMiddleware, async (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const events = await listDivergenceEvents(token, {
        status:    req.query['status']    as string | undefined,
        dimension: req.query['dimension'] as string | undefined,
      });
      return res.json({ events });
    } catch {
      req.log.error('Failed to fetch divergence events', undefined, {
        tenantId: req.tenantContext?.tenant?.id,
      });
      return res.status(500).json({ error: 'Failed to fetch divergence events' });
    }
  });

  // ── Sources ───────────────────────────────────────────────────────────────
  app.get('/api/sources', tenantAuthMiddleware, async (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const sources = await listSources(token);
      return res.json({ sources });
    } catch {
      req.log.error('Failed to fetch sources', undefined, {
        tenantId: req.tenantContext?.tenant?.id,
      });
      return res.status(500).json({ error: 'Failed to fetch sources' });
    }
  });

  // ── Connections ───────────────────────────────────────────────────────────

  app.post('/api/connections', tenantAuthMiddleware, async (req, res) => {
    const { tenantContext } = req;
    const { name, protocol, config, credentials } = req.body as {
      name:        string;
      protocol:    ProtocolType;
      config:      Record<string, unknown>;
      credentials: Record<string, unknown>;
    };

    // Validate required fields
    if (!name || !protocol || !config || !credentials) {
      return res.status(400).json({ error: 'name, protocol, config and credentials are required' });
    }

    const validProtocols: ProtocolType[] = ['mqtt', 'http', 'kafka'];
    if (!validProtocols.includes(protocol)) {
      return res.status(400).json({ error: `Invalid protocol: ${protocol}` });
    }

    // ── Entitlement check ──────────────────────────────────────────────────
    if (!hasModule(tenantContext, protocol)) {
      req.log.warn('Entitlement denied — no subscription for protocol', {
        tenantId: tenantContext.tenant.id,
        protocol,
      });
      return res.status(403).json({
        error: `Your subscription does not include the ${protocol.toUpperCase()} module`,
      });
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      return res.status(501).json({ error: 'Supabase not configured' });
    }

    const store = new ConnectionStore(supabase);

    try {
      const connection = await store.create({
        tenantId:    tenantContext.tenant.id,
        name,
        protocol,
        config,
        credentials,
        createdBy:   tenantContext.user.id,
      });

      if (!connection) {
        return res.status(500).json({ error: 'Failed to create connection' });
      }

      req.log.info('Connection created', {
        tenantId:     tenantContext.tenant.id,
        connectionId: connection.id,
        protocol,
      });

      return res.status(201).json(connection);
    } catch (err) {
      // encryptCredentials throws if CREDENTIAL_ENCRYPTION_KEY is not set
      const message = err instanceof Error ? err.message : 'Failed to create connection';
      req.log.error('Connection create failed', err, { tenantId: tenantContext.tenant.id });
      return res.status(500).json({ error: message });
    }
  });

  app.get('/api/connections', tenantAuthMiddleware, async (req, res) => {
    const supabase = getSupabaseClient();
    if (!supabase) return res.status(501).json({ error: 'Supabase not configured' });

    const store = new ConnectionStore(supabase);
    const connections = await store.list(req.tenantContext.tenant.id);
    return res.json({ connections });
  });

  app.delete('/api/connections/:id', tenantAuthMiddleware, async (req, res) => {
    const supabase = getSupabaseClient();
    if (!supabase) return res.status(501).json({ error: 'Supabase not configured' });

    const store = new ConnectionStore(supabase);
    const deleted = await store.delete(req.tenantContext.tenant.id, req.params.id);

    if (!deleted) return res.status(404).json({ error: 'Connection not found' });

    req.log.info('Connection deleted', {
      tenantId:     req.tenantContext.tenant.id,
      connectionId: req.params.id,
    });

    return res.status(204).send();
  });

  // ── Sessions (stub — ingestion lifecycle managed internally) ──────────────
  app.post('/api/sessions', (req, res) => res.status(501).json({ error: 'Not implemented' }));
  app.get('/api/sessions',  (req, res) => res.status(501).json({ error: 'Not implemented' }));

  console.log('[API] Routes registered (v1.1.0 — Session A hardened)');
}

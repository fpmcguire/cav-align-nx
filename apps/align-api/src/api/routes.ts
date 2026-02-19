/**
 * routes.ts
 *
 * Thin route controllers — no tenant derivation logic.
 * All routes protected by tenantAuthMiddleware.
 * tenantId always comes from req.tenantContext.
 *
 * CAV Level 1 hardening — Section 2 (Routes) of Hardening Directive.
 */

import type { Express } from 'express';
import type { ModuleRegistry } from '../modules/module-registry';
import type { IngestionOrchestrator } from '../ingestion/ingestion-orchestrator';
import type { AlignWebSocketServer } from '../websocket/websocket-server';
import { tenantAuthMiddleware } from '../middleware/auth.middleware';
import { createExpectedDivergenceRouter } from './expected-divergence.routes';
import { createClient } from '@supabase/supabase-js';

export interface ApiDependencies {
  moduleRegistry:       ModuleRegistry;
  ingestionOrchestrator: IngestionOrchestrator;
  wsServer:             AlignWebSocketServer;
}

export function setupApiRoutes(app: Express, deps: ApiDependencies): void {
  const { moduleRegistry } = deps;

  // Public — no auth
  app.get('/api', (req, res) => {
    res.json({
      service:             'align-api',
      version:             '1.1.0',
      registeredProtocols: moduleRegistry.getRegisteredProtocols(),
      activeConnections:   moduleRegistry.getActiveConnectionIds().length,
    });
  });

  // All routes below require valid JWT + tenant
  app.use('/api/expected-divergences', tenantAuthMiddleware, createExpectedDivergenceRouter());

  app.get('/api/divergence', tenantAuthMiddleware, async (req, res) => {
    const tenantId = req.tenantContext?.tenant?.id;
    const url      = process.env['SUPABASE_URL'];
    const key      = process.env['SUPABASE_ANON_KEY'];
    const token    = req.headers.authorization?.replace('Bearer ', '');

    if (!url || !key || !token) {
      return res.status(501).json({ events: [], message: 'Supabase not configured' });
    }

    const supabase = createClient(url, key, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    let query = supabase
      .from('divergence_events')
      .select(`
        id, dimension, status, onset_estimated_at, confirmed_at, resolved_at,
        evidence, device_id,
        sources!inner(source_identifier, tenant_id)
      `)
      .order('onset_estimated_at', { ascending: false })
      .limit(100);

    if (req.query['status'])    query = query.eq('status',    req.query['status'] as string);
    if (req.query['dimension']) query = query.eq('dimension', req.query['dimension'] as string);

    const { data, error } = await query;

    if (error) {
      req.log.error('Failed to fetch divergence events', error, { tenantId });
      return res.status(500).json({ error: 'Failed to fetch divergence events' });
    }

    return res.json({ events: (data ?? []).map(divergenceRowToDto) });
  });

  app.get('/api/sources', tenantAuthMiddleware, async (req, res) => {
    const url   = process.env['SUPABASE_URL'];
    const key   = process.env['SUPABASE_ANON_KEY'];
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!url || !key || !token) {
      return res.status(501).json({ sources: [], message: 'Supabase not configured' });
    }

    const supabase = createClient(url, key, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data, error } = await supabase
      .from('sources')
      .select('id, source_identifier, status, last_message_at, message_count')
      .order('last_message_at', { ascending: false });

    if (error) {
      req.log.error('Failed to fetch sources', error);
      return res.status(500).json({ error: 'Failed to fetch sources' });
    }

    return res.json({ sources: data ?? [] });
  });

  // Stubs — not in v1.1 scope
  app.post('/api/connections', (req, res) => res.status(501).json({ error: 'Not implemented' }));
  app.get('/api/connections',  (req, res) => res.status(501).json({ error: 'Not implemented' }));
  app.post('/api/sessions',    (req, res) => res.status(501).json({ error: 'Not implemented' }));
  app.get('/api/sessions',     (req, res) => res.status(501).json({ error: 'Not implemented' }));

  console.log('[API] Routes registered (v1.1.0 hardened)');
}

function divergenceRowToDto(row: Record<string, unknown>) {
  const source = row['sources'] as Record<string, unknown> | null;
  return {
    id:               row['id'],
    dimension:        row['dimension'],
    status:           row['status'],
    sourceIdentifier: source?.['source_identifier'] ?? null,
    onsetEstimatedAt: row['onset_estimated_at'],
    confirmedAt:      row['confirmed_at'],
    resolvedAt:       row['resolved_at'],
    evidence:         row['evidence'],
    deviceId:         row['device_id'],
  };
}

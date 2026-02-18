/**
 * routes.ts
 *
 * REST API route setup for CAV-Align backend.
 * 
 * Routes:
 *   POST   /api/connections          - Create protocol connection
 *   GET    /api/connections          - List connections
 *   GET    /api/connections/:id      - Get connection details
 *   DELETE /api/connections/:id      - Delete connection
 *   
 *   POST   /api/sessions             - Start alignment session
 *   GET    /api/sessions             - List sessions
 *   GET    /api/sessions/:id         - Get session details
 *   DELETE /api/sessions/:id         - Stop session
 *   
 *   GET    /api/sources              - List sources (with filters)
 *   GET    /api/sources/:id          - Get source details
 *   
 *   GET    /api/divergence           - List divergence events
 *   GET    /api/divergence/:id       - Get divergence details
 *
 * TODO: Implement actual route handlers with Supabase integration
 */

import type { Express } from 'express';
import type { ModuleRegistry } from '../modules/module-registry';
import type { IngestionOrchestrator } from '../ingestion/ingestion-orchestrator';
import type { AlignWebSocketServer } from '../websocket/websocket-server';

export interface ApiDependencies {
  moduleRegistry: ModuleRegistry;
  ingestionOrchestrator: IngestionOrchestrator;
  wsServer: AlignWebSocketServer;
}

export function setupApiRoutes(app: Express, deps: ApiDependencies): void {
  const { moduleRegistry, ingestionOrchestrator, wsServer } = deps;

  // API info
  app.get('/api', (req, res) => {
    res.json({
      service: 'align-api',
      version: '1.0.0',
      registeredProtocols: moduleRegistry.getRegisteredProtocols(),
      activeConnections: moduleRegistry.getActiveConnectionIds().length,
    });
  });

  // TODO: Implement connection management routes
  app.post('/api/connections', (req, res) => {
    res.status(501).json({ error: 'Not implemented yet' });
  });

  app.get('/api/connections', (req, res) => {
    res.status(501).json({ error: 'Not implemented yet' });
  });

  // TODO: Implement session management routes
  app.post('/api/sessions', (req, res) => {
    res.status(501).json({ error: 'Not implemented yet' });
  });

  app.get('/api/sessions', (req, res) => {
    res.status(501).json({ error: 'Not implemented yet' });
  });

  // TODO: Implement source query routes
  app.get('/api/sources', (req, res) => {
    res.status(501).json({ error: 'Not implemented yet' });
  });

  // TODO: Implement divergence query routes
  app.get('/api/divergence', (req, res) => {
    res.status(501).json({ error: 'Not implemented yet' });
  });

  console.log('[API] Routes registered');
}

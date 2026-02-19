/**
 * app.ts
 *
 * Express application setup for the CAV-Align backend (v1.1.0).
 */

import express, { Express } from 'express';
import cors from 'cors';
import { createServer, Server as HttpServer } from 'http';
import { setupWebSocketServer } from './websocket/websocket-server';
import { setupApiRoutes } from './api/routes';
import { ModuleRegistry } from './modules/module-registry';
import { initializeModules } from './modules/initialize-modules';
import { IngestionOrchestrator } from './ingestion/ingestion-orchestrator';
import { getSupabaseClient } from './lib/supabase-client';
import { ExpectedDivergenceMatcher } from './engines/expected-divergence/matcher';

export async function startServer(port: number | string): Promise<HttpServer> {
  const app: Express = express();
  const httpServer = createServer(app);

  app.use(cors());
  app.use(express.json());

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'align-api', version: '1.1.0' });
  });

  // Core services
  const supabase = getSupabaseClient();
  const moduleRegistry = new ModuleRegistry();
  initializeModules(moduleRegistry);

  // WebSocket server must be created before IngestionOrchestrator
  const wsServer = setupWebSocketServer(httpServer);

  const ingestionOrchestrator = new IngestionOrchestrator(moduleRegistry, wsServer, supabase);

  setupApiRoutes(app, { moduleRegistry, ingestionOrchestrator, wsServer });

  // Start expiration checker (every 60 seconds)
  if (supabase) {
    const matcher = new ExpectedDivergenceMatcher(supabase);
    setInterval(() => {
      matcher.checkExpiredWindows().catch((err) =>
        console.error('[ExpirationChecker] error:', err),
      );
    }, 60_000);
    console.log('[app] Expected Divergence expiration checker started');
  }

  await new Promise<void>((resolve) => {
    httpServer.listen(port, () => resolve());
  });

  return httpServer;
}

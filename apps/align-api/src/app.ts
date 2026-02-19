/**
 * app.ts
 *
 * Express application setup for CAV-Align backend (v1.1.0 — hardened).
 *
 * Startup order:
 *   1. Supabase service-role client
 *   2. Store layer (all 4 stores)
 *   3. WebSocket server (JWT-authenticated)
 *   4. Module registry + adapters
 *   5. Ingestion orchestrator (engines + stores injected)
 *   6. API routes (all protected by tenantAuthMiddleware)
 *   7. Expected divergence expiration checker
 */

import express, { type Express } from 'express';
import cors from 'cors';
import { createServer, type Server as HttpServer } from 'http';
import { randomUUID } from 'crypto';
import { setupWebSocketServer } from './websocket/websocket-server';
import { setupApiRoutes } from './api/routes';
import { ModuleRegistry } from './modules/module-registry';
import { initializeModules } from './modules/initialize-modules';
import { IngestionOrchestrator } from './ingestion/ingestion-orchestrator';
import { getSupabaseClient } from './lib/supabase-client';
import { rootLogger } from './lib/logger';
import { ObservedTruthStore } from './stores/observed-truth.store';
import { DivergenceStore } from './stores/divergence.store';
import { ExpectedDivergenceStore } from './stores/expected-divergence.store';
import { SessionStore } from './stores/session.store';

const log = rootLogger.child({ context: 'app' });

export async function startServer(port: number | string): Promise<HttpServer> {
  const app: Express = express();
  const httpServer = createServer(app);

  app.use(cors());
  app.use(express.json());

  // Attach requestId + logger to every request (even unauthenticated)
  app.use((req, _res, next) => {
    req.requestId = randomUUID();
    req.log = rootLogger.child({ requestId: req.requestId });
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({
      status:  'ok',
      service: 'align-api',
      version: '1.1.0',
      supabase: !!getSupabaseClient(),
    });
  });

  // ── 1. Supabase (service role) ──────────────────────────────────────────
  const supabase = getSupabaseClient();

  if (supabase) {
    log.info('Supabase service-role client initialised');
  } else {
    log.warn('Supabase not configured — running in offline/in-memory mode');
  }

  // ── 2. Store layer ──────────────────────────────────────────────────────
  const stores = supabase ? {
    observedTruth:      new ObservedTruthStore(supabase),
    divergence:         new DivergenceStore(supabase),
    expectedDivergence: new ExpectedDivergenceStore(supabase),
    session:            new SessionStore(supabase),
  } : undefined;

  // ── 3. WebSocket server (JWT auth on upgrade) ───────────────────────────
  const wsServer = setupWebSocketServer(httpServer);

  // ── 4. Module registry ──────────────────────────────────────────────────
  const moduleRegistry = new ModuleRegistry();
  initializeModules(moduleRegistry);

  // ── 5. Ingestion orchestrator ───────────────────────────────────────────
  const ingestionOrchestrator = new IngestionOrchestrator(moduleRegistry, wsServer, stores);

  // ── 6. API routes ───────────────────────────────────────────────────────
  setupApiRoutes(app, { moduleRegistry, ingestionOrchestrator, wsServer });

  // ── 7. Expected divergence expiration checker ───────────────────────────
  if (stores) {
    // We need tenant IDs to check — for now we use service-role to fetch all tenants
    // and check expiry per tenant. This is correct: service-role operates across tenants
    // but expiry logic is tenant-scoped within the store method.
    const runExpirationCheck = async () => {
      try {
        const { data: tenants } = await supabase!
          .from('tenants')
          .select('id');
        for (const t of tenants ?? []) {
          await stores.expectedDivergence.markExpiredAsMissed(t.id as string);
        }
      } catch (err) {
        log.error('Expiration checker error', err);
      }
    };
    setInterval(() => void runExpirationCheck(), 60_000);
    log.info('Expected divergence expiration checker started');
  }

  await new Promise<void>((resolve) => {
    httpServer.listen(port, () => resolve());
  });

  log.info('Server started', { port });
  return httpServer;
}

/**
 * app.ts
 *
 * CAV Level 1 — Session D hardening complete (final).
 *
 * Startup order:
 *   1. Supabase (service role) + encryption check
 *   2. Store layer (5 stores)
 *   3. WebSocket server (JWT auth + per-tenant rate limiting)
 *   4. Module registry
 *   5. Ingestion orchestrator
 *   6. Anonymous rate limiting (global, IP-based)
 *   7. API routes
 *   8. Health endpoint (full subsystem detail)
 *   9. Expected divergence expiration checker
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
import { anonRateLimit } from './middleware/rate-limit.middleware';
import { ObservedTruthStore } from './stores/observed-truth.store';
import { DivergenceStore } from './stores/divergence.store';
import { ExpectedDivergenceStore } from './stores/expected-divergence.store';
import { SessionStore } from './stores/session.store';
import { ConnectionStore } from './stores/connection.store';
import { TenantStore } from './stores/tenant.store';
import { IntentVersionStore } from './stores/intent-version.store';
import { DeltaStore } from './stores/delta.store';
import { BreachStore } from './stores/breach.store';
import { ConvergenceActionStore } from './stores/convergence-action.store';
import { isEncryptionConfigured } from './lib/crypto';

const log = rootLogger.child({ context: 'app' });

export async function startServer(port: number | string): Promise<HttpServer> {
  const app: Express = express();
  const httpServer   = createServer(app);

  app.use(cors());
  app.use(express.json());

  // Attach requestId + base logger to every request
  app.use((req, _res, next) => {
    req.requestId = randomUUID();
    req.log       = rootLogger.child({ requestId: req.requestId });
    next();
  });

  // ── 1. Supabase + encryption ────────────────────────────────────────────
  const supabase = getSupabaseClient();
  if (supabase) {
    log.info('Supabase service-role client initialised');
  } else {
    log.warn('Supabase not configured — running in offline/in-memory mode');
  }
  if (!isEncryptionConfigured()) {
    log.warn('CREDENTIAL_ENCRYPTION_KEY not set — set before accepting connections in production');
  } else {
    log.info('Credential encryption configured');
  }

  // ── 2. Store layer ──────────────────────────────────────────────────────
  const stores = supabase ? {
    observedTruth:      new ObservedTruthStore(supabase),
    divergence:         new DivergenceStore(supabase),
    expectedDivergence: new ExpectedDivergenceStore(supabase),
    session:            new SessionStore(supabase),
    // v2 stores — optional; v2 pipeline branch is no-op when absent
    intentVersion:      new IntentVersionStore(supabase),
    delta:              new DeltaStore(supabase),
    breach:             new BreachStore(supabase),
    convergenceAction:  new ConvergenceActionStore(supabase),
  } : undefined;

  // ── 3. WebSocket server ─────────────────────────────────────────────────
  const wsServer = setupWebSocketServer(httpServer);

  // ── 4. Module registry ──────────────────────────────────────────────────
  const moduleRegistry = new ModuleRegistry();
  initializeModules(moduleRegistry);

  // ── 5. Ingestion orchestrator ───────────────────────────────────────────
  const ingestionOrchestrator = new IngestionOrchestrator(moduleRegistry, wsServer, stores);

  // ── 6. Global anonymous rate limiting (IP-based, 30 req/60s) ───────────
  //    Tenant rate limiting (300 req/60s) applied per-router after auth.
  app.use(anonRateLimit);

  // ── 7. Health endpoint (full subsystem detail) ──────────────────────────
  app.get('/health', (_req, res) => {
    const wsStats  = wsServer.getStats();
    const orchStats = ingestionOrchestrator.getStats();

    res.json({
      status:           'ok',
      service:          'align-api',
      version:          '2.0.0',
      timestamp:        new Date().toISOString(),
      subsystems: {
        supabase: {
          configured:   !!supabase,
        },
        encryption: {
          configured:   isEncryptionConfigured(),
        },
        websocket: {
          connectedClients: wsStats.connectedClients,
          activeTenants:    wsStats.tenants,
        },
        ingestion: {
          activeSessions:  orchStats.activeSessions,
          lastMessageAt:   orchStats.lastMessageAt,
          protocols:       moduleRegistry.getRegisteredProtocols(),
        },
      },
    });
  });

  // ── 8. API routes ───────────────────────────────────────────────────────
  setupApiRoutes(app, { moduleRegistry, ingestionOrchestrator, wsServer });

  // ── 9. Expected divergence expiration checker ───────────────────────────
  if (stores) {
    const tenantStore = new TenantStore(supabase!);
    const runExpirationCheck = async () => {
      try {
        const tenantIds = await tenantStore.listTenantIds();
        for (const tenantId of tenantIds) {
          await stores.expectedDivergence.markExpiredAsMissed(tenantId);
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

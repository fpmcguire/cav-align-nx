/**
 * app.ts
 *
 * Express application setup for the CAV-Align backend.
 * Initializes:
 *   - Express middleware
 *   - Supabase client
 *   - Module registry
 *   - WebSocket server
 *   - API routes
 */

import express, { Express } from 'express';
import cors from 'cors';
import { createServer, Server as HttpServer } from 'http';
import { setupWebSocketServer } from './websocket/websocket-server';
import { setupApiRoutes } from './api/routes';
import { ModuleRegistry } from './modules/module-registry';
import { initializeModules } from './modules/initialize-modules';
import { IngestionOrchestrator } from './ingestion/ingestion-orchestrator';

export async function startServer(port: number | string): Promise<HttpServer> {
  const app: Express = express();
  const httpServer = createServer(app);

  // Middleware
  app.use(cors());
  app.use(express.json());

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'align-api', version: '1.0.0' });
  });

  // Initialize core services
  const moduleRegistry = new ModuleRegistry();
  initializeModules(moduleRegistry); // Register MQTT and other protocol adapters
  
  const ingestionOrchestrator = new IngestionOrchestrator(moduleRegistry);

  // Setup WebSocket server for real-time updates
  const wsServer = setupWebSocketServer(httpServer);

  // Setup REST API routes
  setupApiRoutes(app, { moduleRegistry, ingestionOrchestrator, wsServer });

  // Start listening
  await new Promise<void>((resolve) => {
    httpServer.listen(port, () => {
      resolve();
    });
  });

  return httpServer;
}

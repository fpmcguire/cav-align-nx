/**
 * main.ts
 *
 * CAV-Align Backend (align-api)
 * Node/Express server providing:
 *   - Module registry (protocol adapter management)
 *   - Ingestion pipeline (NormalizedMessage processing)
 *   - Observed Truth engine
 *   - Divergence detection engine
 *   - WebSocket server (real-time updates to frontend)
 *   - REST API (connection/session/source/divergence management)
 */

import { startServer } from './app';

const PORT = process.env.PORT || 3000;

startServer(PORT)
  .then(() => {
    console.log(`[align-api] Server running on http://localhost:${PORT}`);
  })
  .catch((err) => {
    console.error('[align-api] Failed to start server:', err);
    process.exit(1);
  });

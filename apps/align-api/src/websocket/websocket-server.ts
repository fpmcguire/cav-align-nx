/**
 * websocket-server.ts
 *
 * CAV Level 1 hardening — complete.
 * - JWT validated on HTTP upgrade
 * - Socket bound to tenantId
 * - Per-tenant message rate limiting (60 frames / 60s)
 * - getStats() for health endpoint
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { Server as HttpServer } from 'http';
import { buildUserClient } from '../lib/supabase-client';
import { SlidingWindowRateLimiter } from '../lib/rate-limiter';
import type { WsClientFrame, WsServerFrame } from '@cav-align/core';
import { rootLogger } from '../lib/logger';
import { randomUUID } from 'crypto';

const log = rootLogger.child({ context: 'WebSocketServer' });

// Per-tenant WS frame rate limit: 60 frames per 60 seconds
const wsRateLimiter = new SlidingWindowRateLimiter({ maxRequests: 60, windowMs: 60_000 });

export interface WsStats {
  connectedClients: number;
  tenants:          number;
}

export interface AlignWebSocketServer {
  broadcast(frame: WsServerFrame): void;
  broadcastToTenant(tenantId: string, frame: WsServerFrame): void;
  broadcastToSession(sessionId: string, frame: WsServerFrame): void;
  getStats(): WsStats;
}

interface AuthenticatedSocket {
  ws:            WebSocket;
  tenantId:      string;
  userId:        string;
  connId:        string;
  subscriptions: Set<string>;
}

// ---------------------------------------------------------------------------
// JWT validation
// ---------------------------------------------------------------------------

async function validateWsToken(token: string): Promise<{ tenantId: string; userId: string } | null> {
  try {
    const supabase = buildUserClient(token);
    if (!supabase) return null;
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return null;
    const { data: tenantUser } = await supabase
      .from('tenant_users').select('tenant_id').eq('user_id', user.id).single();
    if (!tenantUser) return null;
    return { tenantId: tenantUser.tenant_id as string, userId: user.id };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function setupWebSocketServer(httpServer: HttpServer): AlignWebSocketServer {
  const wss     = new WebSocketServer({ noServer: true });
  const clients = new Map<string, AuthenticatedSocket>();

  // ── HTTP upgrade — JWT required ──────────────────────────────────────────
  httpServer.on('upgrade', async (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? '', `http://${req.headers.host}`);

    if (url.pathname !== '/ws') { socket.destroy(); return; }

    const supabaseConfigured = !!(process.env['SUPABASE_URL'] && process.env['SUPABASE_ANON_KEY']);
    if (!supabaseConfigured) {
      // Offline mode — accept without auth
      wss.handleUpgrade(req, socket, head, (ws) => {
        const entry: AuthenticatedSocket = {
          ws, tenantId: 'offline', userId: 'offline',
          connId: randomUUID(), subscriptions: new Set(),
        };
        clients.set(entry.connId, entry);
        wss.emit('connection', ws, req, entry);
      });
      return;
    }

    const token = url.searchParams.get('token');
    if (!token) {
      log.warn('WS upgrade rejected — missing token');
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const auth = await validateWsToken(token);
    if (!auth) {
      log.warn('WS upgrade rejected — invalid token');
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      const entry: AuthenticatedSocket = {
        ws, tenantId: auth.tenantId, userId: auth.userId,
        connId: randomUUID(), subscriptions: new Set(),
      };
      clients.set(entry.connId, entry);
      log.info('WS client connected', { tenantId: auth.tenantId, connId: entry.connId });
      wss.emit('connection', ws, req, entry);
    });
  });

  // ── Connection handler ───────────────────────────────────────────────────
  wss.on('connection', (ws: WebSocket, _req: IncomingMessage, entry: AuthenticatedSocket) => {
    ws.send(JSON.stringify({ type: 'pong' } satisfies WsServerFrame));

    ws.on('message', (data: Buffer) => {
      // Per-tenant rate limit on inbound frames
      const limit = wsRateLimiter.check(entry.tenantId);
      if (!limit.allowed) {
        ws.send(JSON.stringify({
          type: 'status', level: 'warn',
          message: `Rate limit exceeded — retry in ${Math.ceil(limit.resetAfter / 1000)}s`,
        } satisfies WsServerFrame));
        return;
      }

      try {
        const frame: WsClientFrame = JSON.parse(data.toString());
        handleClientFrame(ws, frame, entry);
      } catch (err) {
        log.warn('Invalid WS frame', { connId: entry.connId, error: String(err) });
      }
    });

    ws.on('close', () => {
      clients.delete(entry.connId);
      log.info('WS client disconnected', { tenantId: entry.tenantId, connId: entry.connId });
    });
  });

  // ── Public interface ─────────────────────────────────────────────────────
  return {
    broadcast(frame) {
      const payload = JSON.stringify(frame);
      clients.forEach(({ ws }) => { if (ws.readyState === WebSocket.OPEN) ws.send(payload); });
    },

    broadcastToTenant(tenantId, frame) {
      const payload = JSON.stringify(frame);
      clients.forEach((e) => {
        if (e.tenantId === tenantId && e.ws.readyState === WebSocket.OPEN) e.ws.send(payload);
      });
    },

    broadcastToSession(sessionId, frame) {
      const payload = JSON.stringify(frame);
      clients.forEach((e) => {
        if (e.subscriptions.has(sessionId) && e.ws.readyState === WebSocket.OPEN) e.ws.send(payload);
      });
    },

    getStats(): WsStats {
      const tenants = new Set<string>();
      clients.forEach((e) => tenants.add(e.tenantId));
      return { connectedClients: clients.size, tenants: tenants.size };
    },
  };
}

// ---------------------------------------------------------------------------
// Frame handler
// ---------------------------------------------------------------------------

function handleClientFrame(ws: WebSocket, frame: WsClientFrame, entry: AuthenticatedSocket): void {
  switch (frame.type) {
    case 'subscribe':
      entry.subscriptions.add(frame.sessionId);
      ws.send(JSON.stringify({
        type: 'status', level: 'info',
        message: `Subscribed to session ${frame.sessionId}`,
      } satisfies WsServerFrame));
      break;

    case 'unsubscribe':
      entry.subscriptions.delete(frame.sessionId);
      ws.send(JSON.stringify({
        type: 'status', level: 'info',
        message: `Unsubscribed from session ${frame.sessionId}`,
      } satisfies WsServerFrame));
      break;

    case 'ping':
      ws.send(JSON.stringify({ type: 'pong' } satisfies WsServerFrame));
      break;

    default:
      log.warn('Unknown WS frame type', { connId: entry.connId });
  }
}

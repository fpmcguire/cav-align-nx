/**
 * websocket-server.ts
 *
 * WebSocket server for pushing real-time updates to the Angular frontend.
 *
 * CAV Level 1 hardening — Section 4 of Hardening Directive.
 * - JWT validated during handshake via query param ?token=<jwt>
 * - Socket bound to tenantId on upgrade
 * - Unauthenticated connections rejected
 * - Tenant-scoped channel subscriptions
 *
 * Frames (Server → Client):
 *   topic:discovered, topic:status-changed, divergence:detected,
 *   divergence:resolved, session:stats, broker:status, pong, status
 *
 * Frames (Client → Server):
 *   subscribe, unsubscribe, ping
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { Server as HttpServer } from 'http';
import { buildUserClient } from '../lib/supabase-client';
import type { WsClientFrame, WsServerFrame } from '@cav-align/core';
import { rootLogger } from '../lib/logger';
import { randomUUID } from 'crypto';

const log = rootLogger.child({ context: 'WebSocketServer' });

export interface AlignWebSocketServer {
  broadcast(frame: WsServerFrame): void;
  broadcastToTenant(tenantId: string, frame: WsServerFrame): void;
  broadcastToSession(sessionId: string, frame: WsServerFrame): void;
}

interface AuthenticatedSocket {
  ws:       WebSocket;
  tenantId: string;
  userId:   string;
  connId:   string;
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
      .from('tenant_users')
      .select('tenant_id')
      .eq('user_id', user.id)
      .single();

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
  const wss = new WebSocketServer({ noServer: true });

  // Authenticated clients keyed by connId
  const clients = new Map<string, AuthenticatedSocket>();

  // ---------------------------------------------------------------------------
  // HTTP upgrade — validate JWT before accepting WS
  // ---------------------------------------------------------------------------
  httpServer.on('upgrade', async (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? '', `http://${req.headers.host}`);

    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    // Offline mode — no Supabase configured, accept without auth
    const supabaseConfigured = !!(process.env['SUPABASE_URL'] && process.env['SUPABASE_ANON_KEY']);
    if (!supabaseConfigured) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        const connId = randomUUID();
        const entry: AuthenticatedSocket = {
          ws,
          tenantId: 'offline',
          userId:   'offline',
          connId,
          subscriptions: new Set(),
        };
        clients.set(connId, entry);
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
      const connId = randomUUID();
      const entry: AuthenticatedSocket = {
        ws,
        tenantId: auth.tenantId,
        userId:   auth.userId,
        connId,
        subscriptions: new Set(),
      };
      clients.set(connId, entry);
      log.info('WS client connected', { tenantId: auth.tenantId, connId });
      wss.emit('connection', ws, req, entry);
    });
  });

  // ---------------------------------------------------------------------------
  // Connection handler
  // ---------------------------------------------------------------------------
  wss.on('connection', (ws: WebSocket, _req: IncomingMessage, entry: AuthenticatedSocket) => {
    const pong: WsServerFrame = { type: 'pong' };
    ws.send(JSON.stringify(pong));

    ws.on('message', (data: Buffer) => {
      try {
        const frame: WsClientFrame = JSON.parse(data.toString());
        handleClientFrame(ws, frame, entry, log);
      } catch (err) {
        log.warn('Invalid WS frame', { connId: entry.connId, error: String(err) });
      }
    });

    ws.on('close', () => {
      clients.delete(entry.connId);
      log.info('WS client disconnected', { tenantId: entry.tenantId, connId: entry.connId });
    });
  });

  // ---------------------------------------------------------------------------
  // Public interface
  // ---------------------------------------------------------------------------
  return {
    broadcast(frame: WsServerFrame): void {
      const payload = JSON.stringify(frame);
      clients.forEach(({ ws }) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(payload);
      });
    },

    broadcastToTenant(tenantId: string, frame: WsServerFrame): void {
      const payload = JSON.stringify(frame);
      clients.forEach((entry) => {
        if (entry.tenantId === tenantId && entry.ws.readyState === WebSocket.OPEN) {
          entry.ws.send(payload);
        }
      });
    },

    broadcastToSession(sessionId: string, frame: WsServerFrame): void {
      const payload = JSON.stringify(frame);
      clients.forEach((entry) => {
        if (entry.subscriptions.has(sessionId) && entry.ws.readyState === WebSocket.OPEN) {
          entry.ws.send(payload);
        }
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Frame handler
// ---------------------------------------------------------------------------

function handleClientFrame(
  ws: WebSocket,
  frame: WsClientFrame,
  entry: AuthenticatedSocket,
  logger: typeof log,
): void {
  switch (frame.type) {
    case 'subscribe': {
      entry.subscriptions.add(frame.sessionId);
      const status: WsServerFrame = {
        type:    'status',
        level:   'info',
        message: `Subscribed to session ${frame.sessionId}`,
      };
      ws.send(JSON.stringify(status));
      logger.debug('WS subscribed to session', { connId: entry.connId, sessionId: frame.sessionId });
      break;
    }

    case 'unsubscribe': {
      entry.subscriptions.delete(frame.sessionId);
      const status: WsServerFrame = {
        type:    'status',
        level:   'info',
        message: `Unsubscribed from session ${frame.sessionId}`,
      };
      ws.send(JSON.stringify(status));
      break;
    }

    case 'ping': {
      const pong: WsServerFrame = { type: 'pong' };
      ws.send(JSON.stringify(pong));
      break;
    }

    default:
      logger.warn('Unknown WS frame type', { connId: entry.connId });
  }
}

/**
 * websocket-server.ts
 *
 * WebSocket server for pushing real-time updates to the Angular frontend.
 * 
 * Frames (Server → Client):
 *   - topic:discovered
 *   - topic:status-changed
 *   - divergence:detected
 *   - divergence:resolved
 *   - session:stats
 *   - broker:status
 *
 * Frames (Client → Server):
 *   - subscribe (sessionId)
 *   - unsubscribe (sessionId)
 *   - ping
 *
 * Uses the WsServerFrame / WsClientFrame types from @cav-align/core.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'http';
import type { WsClientFrame, WsServerFrame } from '@cav-align/core';

export interface AlignWebSocketServer {
  broadcast(frame: WsServerFrame): void;
  broadcastToSession(sessionId: string, frame: WsServerFrame): void;
}

/**
 * Setup the WebSocket server for real-time updates.
 */
export function setupWebSocketServer(httpServer: HttpServer): AlignWebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  // Track clients by session subscription
  const sessionSubscriptions = new Map<string, Set<WebSocket>>();

  wss.on('connection', (ws: WebSocket) => {
    console.log('[WebSocket] Client connected');

    ws.on('message', (data: Buffer) => {
      try {
        const frame: WsClientFrame = JSON.parse(data.toString());
        handleClientFrame(ws, frame, sessionSubscriptions);
      } catch (err) {
        console.error('[WebSocket] Invalid frame from client:', err);
      }
    });

    ws.on('close', () => {
      console.log('[WebSocket] Client disconnected');
      // Remove from all session subscriptions
      sessionSubscriptions.forEach((clients) => clients.delete(ws));
    });

    // Send initial pong
    const pongFrame: WsServerFrame = { type: 'pong' };
    ws.send(JSON.stringify(pongFrame));
  });

  return {
    broadcast(frame: WsServerFrame): void {
      const payload = JSON.stringify(frame);
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload);
        }
      });
    },

    broadcastToSession(sessionId: string, frame: WsServerFrame): void {
      const clients = sessionSubscriptions.get(sessionId);
      if (!clients) return;

      const payload = JSON.stringify(frame);
      clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload);
        }
      });
    },
  };
}

function handleClientFrame(
  ws: WebSocket,
  frame: WsClientFrame,
  sessionSubscriptions: Map<string, Set<WebSocket>>
): void {
  switch (frame.type) {
    case 'subscribe': {
      let clients = sessionSubscriptions.get(frame.sessionId);
      if (!clients) {
        clients = new Set();
        sessionSubscriptions.set(frame.sessionId, clients);
      }
      clients.add(ws);
      
      const statusFrame: WsServerFrame = {
        type: 'status',
        level: 'info',
        message: `Subscribed to session ${frame.sessionId}`,
      };
      ws.send(JSON.stringify(statusFrame));
      break;
    }

    case 'unsubscribe': {
      const clients = sessionSubscriptions.get(frame.sessionId);
      if (clients) {
        clients.delete(ws);
      }
      
      const statusFrame: WsServerFrame = {
        type: 'status',
        level: 'info',
        message: `Unsubscribed from session ${frame.sessionId}`,
      };
      ws.send(JSON.stringify(statusFrame));
      break;
    }

    case 'ping': {
      const pongFrame: WsServerFrame = { type: 'pong' };
      ws.send(JSON.stringify(pongFrame));
      break;
    }

    default:
      console.warn('[WebSocket] Unknown frame type from client:', frame);
  }
}
